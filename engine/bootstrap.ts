/**
 * @file engine/bootstrap.ts
 * @description Async scene assembly for the star-field engine. Loads
 * three lazily (the chunk only ships when the route mounts), probes
 * WebGPU→WebGL renderer, textures every mapped body in parallel with
 * progress, builds skybox/lights/bodies/picking, warms shaders, then
 * starts the tick loop. Every `await` is followed by a disposed check —
 * destroy() during a slow texture load must not keep mutating a torn-down
 * scene.
 */
import { WINDOW_EVENTS } from '@core/tokens/events/dom.js'
import { SF_TEXTURES } from '@core/tokens/starfield/textures.js'
import { initStarRenderer } from './renderer-setup.js'
import { makeGlowTexture, setupStarCamera, setupStarScene } from './scene.js'
import { buildStarBodies } from './bodies-scene.js'
import { ensureStarCloud } from './star-cloud.js'
import { armPicking, bindPicking } from './picking.js'
import { armFrame, handleStarResize, tickStar } from './frame.js'
import { buildStarPostPipeline } from './post.js'
import type * as THREE_NS from 'three'
import { SF_CATALOG } from './catalog.js'
import type { SFBodyDef, SFState } from './types.js'
import { devWarn } from '@core/devlog.js'

type ThreeModule = typeof import('three')

/**
 * Collects every texture URL a catalog slice + the skybox needs — all
 * six body texture slots plus each companion satellite's own photo
 * (`sat.texture`), so an authored companion map preloads with its
 * host's and `makeSatellites` never lands the not-in-map fallback for
 * a real file. Exported so the satellite arm is unit-testable on a
 * fixture slice — the live catalog's own scan happens inside
 * `bootstrapStarField` where no fixture can inject a textured sat.
 * @param defs Catalog entries to scan.
 * @returns The deduplicated URL set (skybox included).
 */
export function catalogTextureUrls(defs: readonly SFBodyDef[]): Set<string> {
  const urls = new Set<string>([SF_TEXTURES.SKYBOX])

  for (const def of defs) {
    if (def.texture) urls.add(def.texture)
    if (def.shellTexture) urls.add(def.shellTexture)
    if (def.normalTexture) urls.add(def.normalTexture)
    if (def.emissiveTexture) urls.add(def.emissiveTexture)
    if (def.cloudTexture) urls.add(def.cloudTexture)
    if (def.bumpTexture) urls.add(def.bumpTexture)

    // Companion satellites can declare their own photo — preload it
    // with the host's maps so makeSatellites never hits the
    // not-in-map fallback for an authored texture.
    for (const sat of def.satellites ?? []) {
      if (sat.texture) urls.add(sat.texture)
    }
  }

  return urls
}

/**
 * Loads `catalogTextureUrls(SF_CATALOG)` in parallel — progress reports
 * per completed file so the loader bar climbs smoothly across the ~14
 * fetches. A single failed texture resolves as undefined (the body
 * falls back to its procedural color) rather than sinking the whole
 * boot.
 * @returns URL → texture map (missing textures absent).
 */
async function loadStarTextures(
  THREE: ThreeModule,
  s: SFState
): Promise<Map<string, THREE_NS.Texture>> {
  const urls = catalogTextureUrls(SF_CATALOG)

  const loader = new THREE.TextureLoader()

  const map = new Map<string, THREE_NS.Texture>()

  const list = [...urls]

  let done = 0

  await Promise.all(
    list.map(async (url) => {
      try {
        const tex = await loader.loadAsync(url)

        // Photographic maps are sRGB files — without the tag three.js
        // samples them as linear, washing out bands/nebula color into
        // the pale flat look. Normal maps are exempt (data, not color),
        // and it costs nothing to skip them here since only Earth wires
        // one (kept linear by the loader default anyway).
        if (url !== SF_TEXTURES.EARTH_NORMAL) tex.colorSpace = THREE.SRGBColorSpace

        map.set(url, tex)
      } catch (e) {
        devWarn('[StarField] texture failed:', url, e)
      }

      done += 1

      s.onProgress?.('Loading star charts…', 10 + (done / list.length) * 70)
    })
  )

  return map
}

/**
 * Pre-compiles shader programs so the first visible frame doesn't hitch
 * on JIT — failures are non-fatal (the renderer recompiles lazily).
 */
async function warmUpShaders(
  renderer: NonNullable<SFState['renderer']>,
  s: SFState
): Promise<void> {
  const { scene, camera } = s

  const r = renderer as { compileAsync?: (sc: unknown, cam: unknown) => Promise<void> }

  try {
    if (scene && camera && r.compileAsync) await r.compileAsync(scene, camera)
  } catch (err) {
    devWarn('[StarField] Shader compile warmup notice:', err)
  }
}

/**
 * Bootstraps the star-field engine — full sequence: three import →
 * renderer probe → scene/camera/controls → texture parallel load →
 * body graph → picking → resize → shader warmup → first frame → ready.
 * Silent bailouts (webglAllowed, probe failure, dispose mid-boot) leave
 * `s.failed`/partial state for init() to flag.
 * @param s Engine state.
 */
export async function bootstrapStarField(s: SFState): Promise<void> {
  const THREE = await import('three')

  const [
    { WebGPURenderer, MeshBasicNodeMaterial, MeshStandardNodeMaterial, RenderPipeline },
    TSL,
    { OrbitControls },
    { bloom },
    { film },
  ] = await Promise.all([
    import('three/webgpu'),
    import('three/tsl'),
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('three/examples/jsm/tsl/display/BloomNode.js'),
    import('three/examples/jsm/tsl/display/FilmNode.js'),
  ])

  if (s.disposed) return

  armPicking(THREE.Raycaster)
  armFrame(THREE.Vector3 as never, THREE.Color as never)

  /* Renderer */
  s.onProgress?.('Initializing renderer…', 5)

  if (!(await initStarRenderer(s, WebGPURenderer)) || !s.renderer) return

  /* Scene / camera / controls — setupStarCamera is synchronous, so the
     disposed flag can't flip mid-call (renderer probe already returns
     !s.disposed upstream). */
  setupStarCamera(s, THREE, OrbitControls)

  /* Textures — the long pole; progress 10→80 */
  const texMap = await loadStarTextures(THREE, s)

  if (s.disposed) return

  setupStarScene(s, THREE, texMap.get(SF_TEXTURES.SKYBOX))

  /* Bodies */
  s.onProgress?.('Charting the skies…', 84)

  const glowTex = makeGlowTexture(THREE)

  // Lazy-spawn handles — registry-body.ts materializes deep-catalog
  // records on selection long after boot, so the module, node-material
  // deps and the shared glow sprite ride on the state bag.
  s.THREE = THREE
  s.deps = { TSL, mats: { MeshBasicNodeMaterial, MeshStandardNodeMaterial } }
  s.glowTex = glowTex ?? null

  // Shared FX uniforms — one uniform node each for scene time and the
  // solar-wind level; updateFx writes them once per frame and every
  // weather/aurora/flare shader reads the same pair, so the storm
  // propagation from Sun to planets is frame-coherent.
  s.fxTime = TSL.uniform(0) as unknown as { value: number }

  s.solarWind = TSL.uniform(0) as unknown as { value: number }

  // Custom-shaded surfaces (fresnel limbs, boundary shells, the Sgr A*
  // disc) are TSL node materials — the WebGPURenderer pipeline rejects
  // classic ShaderMaterials — so the TSL namespace and the node-material
  // ctor are injected into every body maker from here.
  buildStarBodies(s, THREE, s.deps!, SF_CATALOG, texMap, glowTex)

  /* Picking */
  bindPicking(s)

  /* Resize + warmup */
  handleStarResize(s)

  s.onResize = () => handleStarResize(s)

  window.addEventListener(WINDOW_EVENTS.RESIZE, s.onResize)

  s.onProgress?.('Compiling shaders…', 92)

  await warmUpShaders(s.renderer, s)

  if (s.disposed) return

  /* Post chain — bloom + vignette + grain. Built after warmup so the
     scene pass compiles against already-hot materials; failure is
     non-fatal (frame falls back to a plain render). */
  buildStarPostPipeline(s, { TSL, RenderPipeline, bloom, film })

  if (!s.reduced) tickStar(s)

  /* Real-catalogue star cloud — streams the packed HYG binary in the
     background and mounts it on the Milky Way disc when it decodes;
     fire-and-forget so boot never blocks on the 1.5 MB asset. */
  ensureStarCloud(s, THREE)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__sfDebug = s

  s.onProgress?.('Ready', 100)
}
