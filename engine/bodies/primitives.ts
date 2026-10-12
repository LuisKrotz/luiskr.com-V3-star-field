/**
 * @file engine/bodies/primitives.ts
 * @description Per-body mesh builders for the scene-graph assembler in
 * `../bodies-scene.ts` — textured/fresnel spheres, pick proxies, cloud
 * and ring shells, the additive star halo, and decorative satellite
 * pivots. Split out of bodies-scene.ts so the orchestrator stays a
 * readable dispatch over the body kinds.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL, SF_SCENE } from '@core/tokens/starfield/params.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { haloFor, pointGlowFor, starSurfaceFor, surfaceFor } from './procedural.js'
import { matParams } from '../materials.js'
import type { SFBodyDef, SFNode, SFNodeDeps } from '../types.js'

type ThreeModule = typeof import('three')

/** `userData` key carrying the body id from mesh → raycast hit. */
export const SF_USER_BODY = 'bodyId'

/**
 * `userData` flag marking an invisible oversized pick proxy — picking
 * prefers a real-mesh hit down the ray so proxy bubbles never eclipse
 * the bodies they overlap.
 */
export const SF_USER_PROXY = 'pickProxy'

/**
 * Invisible pick bubble for bodies too small to hit reliably — planets
 * and moons under `SF_DETAIL.PICK_MIN` world units subtend a handful of
 * pixels at the home camera, so a slightly larger transparent sphere
 * (riding inside `mesh` to inherit orbit position and spin) gives the
 * raycaster a usable target. Marked `SF_USER_PROXY` so a real-mesh hit
 * along the same ray always wins; the caller stamps the body id on
 * `userData` since the proxy is shared across kinds.
 * @param THREE The three.js module.
 * @param radius The body's true radius — the proxy scales with it so
 *   honest stellar-scale bodies stay pickable without a fixed giant
 *   bubble swallowing neighbouring stars.
 * @returns The invisible proxy mesh.
 */
export function makePickProxy(THREE: ThreeModule, radius: number): THREE_NS.Object3D {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(radius * SF_DETAIL.PICK_PROXY, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  )

  proxy.userData[SF_USER_PROXY] = true

  return proxy
}

/**
 * Luminous-sphere node material — a star's disc must not read as a flat
 * polygon. The fresnel rim `(1 − |view·n|)^falloff` mixes the body's
 * color/texture toward the limb tint and dips the alpha at the extreme
 * silhouette, so the photosphere dissolves into its additive halo
 * instead of cutting a hard circle against the sky. Built as a
 * MeshBasicNodeMaterial — the WebGPURenderer node pipeline rejects
 * classic GLSL ShaderMaterials.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param colorHex Core tint (def.color; SUN_LIGHT fallback).
 * @param tex Optional photosphere texture — modulates the core.
 * @param rimTint Limb color (hot rim for stars, muted for moons).
 * @param falloff Fresnel exponent — higher keeps a tight bright core.
 */
export function makeGlowSphereMaterial(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  colorHex: number | undefined,
  tex: THREE_NS.Texture | undefined,
  rimTint: number,
  falloff: number
): THREE_NS.Material {
  const { TSL, mats } = deps

  const { mix, normalize, cameraPosition, positionWorld, normalWorld, pow, dot, vec3, texture } =
    TSL

  // Fresnel rim factor — 0 face-on, →1 at the grazing silhouette.
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const fres = pow(dot(viewDir, normalWorld).abs().oneMinus(), falloff)

  const mat = new mats.MeshBasicNodeMaterial()

  // Tints as vec3 constants — color nodes only support scalar mul, but
  // the texture modulate needs componentwise vec3×vec3.
  const coreC = new THREE.Color(colorHex ?? SF_COLORS.SUN_LIGHT)
  const coreTint = vec3(coreC.r, coreC.g, coreC.b)

  const rimC = new THREE.Color(rimTint)
  const rim = vec3(rimC.r, rimC.g, rimC.b)

  // core·tex → limb tint across the fresnel; alpha dips at the extreme
  // silhouette so the sphere edge melts into the halo instead of a
  // raytraced-crisp circle.
  mat.colorNode = tex ? mix(coreTint.mul(texture(tex).rgb), rim, fres) : mix(coreTint, rim, fres)
  mat.transparent = true
  mat.opacityNode = fres.mul(0.55).oneMinus()

  return mat
}

/**
 * Sphere + material for a solid body — textured when the catalog maps one,
 * tinted procedural otherwise. Stars/systems use the fresnel-limb node
 * material (they emit their own light); planets and smaller get lit
 * MeshStandard. When `sunDir` is passed (day/night registry vector) the
 * body upgrades to `MeshStandardNodeMaterial` so the emissive layer can
 * be gated by the sun direction — city lights never glow on the lit
 * hemisphere.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors.
 * @param def Catalog entry.
 * @param texMap Loaded texture map keyed by URL.
 * @param sunDir Shared sun-direction vector (mutated per frame by
 * `updateDayNight`) — gates the emissive map through `emissiveNode`.
 */
export function makeSphere(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  texMap: Map<string, THREE_NS.Texture>,
  sunDir?: THREE_NS.Vector3
) {
  const geo = new THREE.SphereGeometry(
    def.radius,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const luminous = def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM

  if (luminous) {
    return new THREE.Mesh(
      geo,
      makeGlowSphereMaterial(
        THREE,
        deps,
        def.color,
        // No photosphere map → seeded granulation so every star carries
        // a boiling surface under the fresnel limb instead of an
        // eggshell-smooth disc.
        texMap.get(def.texture ?? '') ?? starSurfaceFor(THREE, def),
        // `def.rim` carries limb darkening (dark amber silhouette) on
        // resolved star discs; distant stars keep the hot white rim.
        def.rim ?? SF_COLORS.STAR_RIM,
        SF_DETAIL.STAR_RIM_FALLOFF
      )
    )
  }

  const emiTex = def.emissiveTexture ? texMap.get(def.emissiveTexture) : undefined

  // Node-material path — needed when the emissive map must be gated by
  // the live sun direction (unlit `emissiveMap` would glow on the day
  // side). Falls back to classic MeshStandard when no gating applies.
  const StdCtor =
    sunDir && deps.mats.MeshStandardNodeMaterial
      ? deps.mats.MeshStandardNodeMaterial
      : THREE.MeshStandardMaterial

  const mat = new StdCtor(
    matParams({
      // No photo map → seeded procedural surface (mottle/bands/craters)
      // so untextured moons, dwarf planets and exoplanets read as real
      // worlds instead of flat tinted balls.
      map: texMap.get(def.texture ?? '') ?? surfaceFor(THREE, def),
      color: def.color,
    })
  )

  // Relief + night-lights detail layers — Earth's three extra maps land
  // on the same material: `normalMap` shades terrain relief under the
  // sun light rig, `emissiveMap` carries city lights that stay black on
  // the day side.
  const nrmTex = def.normalTexture ? texMap.get(def.normalTexture) : undefined

  if (nrmTex) mat.normalMap = nrmTex

  const bumpTex = def.bumpTexture ? texMap.get(def.bumpTexture) : undefined

  if (bumpTex) {
    mat.bumpMap = bumpTex
    mat.bumpScale = SF_DETAIL.BUMP_SCALE
  }

  if (emiTex) {
    if (sunDir && deps.mats.MeshStandardNodeMaterial) {
      const { dot, normalWorld, smoothstep, texture, uniform, vec3 } = deps.TSL

      const eC = new THREE.Color(SF_COLORS.SUN_LIGHT)

      // Twilight gate — `dot(worldNormal, sunDir)` smoothstepped so city
      // lights bloom only past the terminator and fade in through dusk;
      // the lit hemisphere contributes zero emissive.
      const dayF = smoothstep(
        SF_DETAIL.NIGHT_LO,
        SF_DETAIL.NIGHT_HI,
        dot(normalWorld, uniform(sunDir))
      )

      ;(mat as unknown as { emissiveNode: unknown }).emissiveNode = texture(emiTex)
        .rgb.mul(vec3(eC.r, eC.g, eC.b))
        .mul(SF_DETAIL.EMISSIVE_INT)
        .mul(dayF.oneMinus())
    } else {
      mat.emissiveMap = emiTex
      mat.emissive = new THREE.Color(SF_COLORS.SUN_LIGHT)
      mat.emissiveIntensity = SF_DETAIL.EMISSIVE_INT
    }
  }

  return new THREE.Mesh(geo, mat)
}

/**
 * Extra translucent sphere one shell above a surface — Earth's cloud
 * deck rides a white-on-black map under additive blending so the dark
 * sky between clouds contributes nothing; the deck scales slightly past
 * the surface sphere so it reads as atmosphere, not paint.
 * @param THREE The three.js module.
 * @param def Catalog entry (radius sizes the shell).
 * @param cloudTex The loaded cloud map (caller guards its presence).
 */
export function makeCloudShell(
  THREE: ThreeModule,
  def: SFBodyDef,
  cloudTex: THREE_NS.Texture
): THREE_NS.Object3D {
  const geo = new THREE.SphereGeometry(
    def.radius * SF_DETAIL.CLOUD_SCALE,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: SF_DETAIL.CLOUD_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  return new THREE.Mesh(geo, mat)
}

/**
 * Atmosphere rim shell — a fresnel-limb translucent sphere just past
 * the surface whose tint migrates with the sun direction: deep blue on
 * the night limb, bright scattering blue on the day limb, and a warm
 * amber band through the terminator (rayleigh→mie analogy). Opacity
 * also dims on the night side so the rim reads thinnest where the air
 * is unlit. `updateDayNight` keeps the shared `sunDir` vector current.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param def Catalog entry — `def.atmosphere` scales the base opacity.
 * @param sunDir Shared sun-direction vector (mutated per frame).
 */
export function makeAtmoShell(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  sunDir: THREE_NS.Vector3
): THREE_NS.Object3D {
  const { TSL } = deps

  const {
    cameraPosition,
    dot,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    uniform,
    vec3,
  } = TSL

  const geo = new THREE.SphereGeometry(
    def.radius * SF_DETAIL.ATMO_SCALE,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new deps.mats.MeshBasicNodeMaterial()

  // Fresnel limb factor — 0 face-on, →1 at the grazing silhouette.
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const fres = pow(dot(viewDir, normalWorld).abs().oneMinus(), SF_DETAIL.ATMO_POW)

  const ndl = dot(normalWorld, uniform(sunDir))

  // Day factor + a dusk band centered just past the terminator.
  const dayF = smoothstep(SF_DETAIL.ATMO_DAY_LO, SF_DETAIL.ATMO_DAY_HI, ndl)
  const duskF = smoothstep(SF_DETAIL.ATMO_DUSK_LO, SF_DETAIL.ATMO_DUSK_MID, ndl).mul(
    smoothstep(SF_DETAIL.ATMO_DUSK_MID, SF_DETAIL.ATMO_DUSK_HI, ndl).oneMinus()
  )

  const dayC = new THREE.Color(SF_COLORS.ATMO_DAY)
  const duskC = new THREE.Color(SF_COLORS.ATMO_DUSK)
  const nightC = new THREE.Color(SF_COLORS.ATMO_NIGHT)

  const tint = mix(
    mix(vec3(nightC.r, nightC.g, nightC.b), vec3(dayC.r, dayC.g, dayC.b), dayF),
    vec3(duskC.r, duskC.g, duskC.b),
    duskF
  )

  mat.colorNode = tint
  mat.transparent = true
  mat.opacityNode = fres
    .mul(SF_DETAIL.ATMO_ALPHA * (def.atmosphere ?? 1))
    .mul(dayF.mul(0.65).add(0.35))
  mat.blending = THREE.AdditiveBlending
  mat.depthWrite = false

  return new THREE.Mesh(geo, mat)
}

/**
 * Additive halo sprite behind a luminous body — stars and the Sun glow
 * like point sources on a real long-exposure frame instead of rendering
 * as flat colored balls. Kept off the LOD `detail` list: a star's glow
 * IS its far-field representation.
 * @param THREE The three.js module.
 * @param def Catalog entry (color tints the halo).
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 * @param flat Point-star mode — a filled core glow (no photosphere behind
 *   it); default annulus leaves a transparent cut for the ball's limb.
 */
export function makeStarHalo(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined,
  flat?: boolean
): THREE_NS.Sprite {
  const size = def.radius * SF_DETAIL.HALO_SCALE

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial(
      matParams({
        // Annulus halo — a radial-gradient glow sprite is centered on the
        // ball, so its brightest ring lands on the photosphere and
        // saturates it to white; the annulus keeps the glow outside the
        // limb with the body's tint baked in (SpriteMaterial `color`
        // doesn't multiply the map under the node pipeline). Point stars
        // (sphere-less galactic markers) take the filled core variant —
        // an annulus around nothing would render a hollow ring.
        map: (flat ? pointGlowFor(THREE, def) : haloFor(THREE, def)) ?? glowTex,
        transparent: true,
        opacity: SF_DETAIL.HALO_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  )

  sprite.scale.set(size, size, 1)

  return sprite
}

/**
 * Translucent shell layer — Venus's haze atmosphere and Saturn's ring get
 * a secondary texture-mapped surface parented to the main mesh. Returns
 * the created Object3D so the caller can register it as LOD detail.
 * @param THREE The three.js module.
 * @param def Catalog entry.
 * @param shellTexture Shell texture URL — narrowed non-null by the caller's
 *   `if (def.shellTexture)` guard.
 * @param parent The primary mesh the shell rides on.
 * @param texMap Loaded texture map keyed by URL.
 */
export function makeShell(
  THREE: ThreeModule,
  def: SFBodyDef,
  shellTexture: string,
  parent: { add(o: unknown): unknown },
  texMap: Map<string, THREE_NS.Texture>
): THREE_NS.Object3D {
  const tex = texMap.get(shellTexture)

  if (def.shellRing) {
    const inner = def.radius * SF_DETAIL.RING_INNER

    const outer = def.radius * SF_DETAIL.RING_OUTER

    const geo = new THREE.RingGeometry(inner, outer, SF_SCENE.RING_SEGMENTS)

    /**
     * RingGeometry ships planar UVs (the ring occupies uv-space like a
     * circle inscribed in a square), but the Saturn strip texture is
     * radius-indexed — u sweeps inner→outer across the banded ring face.
     * Remap each vertex's u to its normalized radius (v rides the strip's
     * center row) so the C/B/A ring bands and the Cassini gap land at
     * their true radii instead of smearing into a solid plate.
     */
    const posAttr = geo.getAttribute('position')

    const uvAttr = geo.getAttribute('uv')

    // `Math.max(1, ·)` guards the degenerate-attribute case (mocked or
    // stripped geometries) — a real RingGeometry always has vertices.
    for (let i = 0; i < Math.max(1, posAttr.count); i++) {
      const r = Math.hypot(posAttr.getX(i), posAttr.getY(i))

      uvAttr.setXY(i, (r - inner) / (outer - inner), SF_DETAIL.RING_V)
    }

    const mat = new THREE.MeshBasicMaterial(
      matParams({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )

    const ring = new THREE.Mesh(geo, mat)

    ring.rotation.x = -Math.PI / 2 + (def.tilt ?? 0.3)

    parent.add(ring)

    return ring
  }

  const geo = new THREE.SphereGeometry(
    def.radius * 1.06,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new THREE.MeshBasicMaterial(matParams({ map: tex, transparent: true, opacity: 0.65 }))

  const shell = new THREE.Mesh(geo, mat)

  parent.add(shell)

  return shell
}

/**
 * Decorative companion satellites — small unlit spheres on child pivots;
 * `satPivots` returns the {pivot,speed,phase} records frame.ts rotates.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors.
 * @param def Catalog entry — `satellites` lists the companions.
 * @param mesh The host body mesh — pivots attach to it to orbit.
 */
export function makeSatellites(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  mesh: { add(o: unknown): unknown }
) {
  const satPivots: SFNode['satPivots'] = []

  for (const sat of def.satellites ?? []) {
    const pivot = new THREE.Object3D()

    const geo = new THREE.SphereGeometry(sat.radius, 24, 12)

    // Companion dots share the fresnel-limb material (dim rim, loose
    // falloff) so they read as small glowing bodies, not hard discs.
    const mat = makeGlowSphereMaterial(
      THREE,
      deps,
      sat.color,
      undefined,
      sat.color ?? SF_COLORS.SUN_LIGHT,
      SF_DETAIL.SAT_RIM_FALLOFF
    )

    const sm = new THREE.Mesh(geo, mat)

    sm.position.x = sat.orbit

    pivot.add(sm)

    pivot.rotation.y = sat.phase ?? 0

    mesh.add(pivot)

    satPivots.push({
      pivot,
      mesh: sm,
      speed: sat.speed,
      phase: sat.phase ?? 0,
      orbit: sat.orbit,
      ecc: sat.ecc,
    })
  }

  return satPivots
}
