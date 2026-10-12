/**
 * @file engine/post.ts
 * @description Post-processing chain for the star-field engine —
 * the RenderPipeline assembly:
 *
 *   scene → +bloom → vignette → film grain
 *
 * Bloom is what sells the HDR look (suns, coronae, nebula cores and the
 * accretion ring bleed light like a real sensor sees them); the vignette
 * recedes the frame edges like an eyepiece; film grain kills additive-
 * gradient banding on the dark background. Pipeline failure is
 * non-fatal: the frame loop falls back to `renderer.render(scene, camera)`
 * losing post FX but not the scene — the same contract as the earth
 * engine's chain.
 */
import type { Node } from 'three/webgpu'
import { SF_POST } from '@core/tokens/starfield/params.js'
import { devWarn } from '@core/devlog.js'
import { makeSFVignetteNode } from './post-nodes.js'
import type { SFVignetteNodeArgs } from './post-nodes.js'
import type { SFState } from './types.js'

type TslNs = typeof import('three/tsl')
type WebGpuModule = typeof import('three/webgpu')
type BloomFn = typeof import('three/examples/jsm/tsl/display/BloomNode.js').bloom
type FilmFn = typeof import('three/examples/jsm/tsl/display/FilmNode.js').film

/**
 * Post-chain dependencies — lazy-imported in bootstrap so the TSL graph
 * and the display nodes only load when the WebGL engine actually boots.
 */
export interface SFPostDeps {
  /** three/tsl namespace. */
  TSL: TslNs
  /** RenderPipeline class from three/webgpu. */
  RenderPipeline: WebGpuModule['RenderPipeline']
  /** Unreal-style bloom node. */
  bloom: BloomFn
  /** Film grain node. */
  film: FilmFn
}

/**
 * Assembles the RenderPipeline post chain (screen-space, in order):
 *   scene → +bloom → vignette → film grain
 * Bloom sits first so the vignette shapes the halos too, and grain lands
 * last so it dithers the final frame. On any failure the pipeline is
 * torn down and `s.pipeline` stays null — the frame loop then renders
 * the scene directly with no post.
 * @param s Engine state (renderer/scene/camera must be live).
 * @param deps Lazy-loaded TSL/post dependencies.
 */
export function buildStarPostPipeline(s: SFState, deps: SFPostDeps): void {
  const { TSL, RenderPipeline, bloom, film } = deps

  if (!s.renderer || !s.scene || !s.camera) return

  try {
    // `s.renderer` stays structurally typed (mockable); the real object
    // is always the WebGPURenderer bootstrap created.
    s.pipeline = new RenderPipeline(s.renderer as never)

    const scenePass = TSL.pass(s.scene, s.camera)

    const sceneColor = scenePass.getTextureNode('output')

    const bloomPass = bloom(
      sceneColor,
      SF_POST.BLOOM_STRENGTH,
      SF_POST.BLOOM_RADIUS,
      SF_POST.BLOOM_THRESHOLD
    )

    const baseWithBloom = (sceneColor as unknown as { add(_b: Node<'vec4'>): Node<'vec4'> }).add(
      bloomPass as unknown as Node<'vec4'>
    )

    const vignetteNode = makeSFVignetteNode(TSL) as unknown as (
      args: SFVignetteNodeArgs
    ) => Node<'vec4'>

    const withVig = vignetteNode({
      color: baseWithBloom,
      uv: TSL.screenCoordinate.div(TSL.screenSize),
      darkness: TSL.float(SF_POST.VIGNETTE_DARKNESS),
      offset: TSL.float(SF_POST.VIGNETTE_OFFSET),
    })

    ;(s.pipeline as unknown as { outputNode: unknown }).outputNode = film(
      withVig,
      TSL.float(SF_POST.GRAIN_INTENSITY)
    )
  } catch (e) {
    devWarn('[StarField] RenderPipeline setup skipped:', e)

    s.pipeline = null
  }
}
