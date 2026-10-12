/**
 * @file engine/post-nodes.ts
 * @description Custom TSL post nodes for the star-field RenderPipeline
 * chain. Pure node-graph builders — no class state, no GPU probing.
 * The vignette is gentler than the earth engine's: space reads best
 * with edges that recede like an eyepiece, not a dark oval frame.
 */
import type { Node } from 'three/webgpu'

type TslNs = typeof import('three/tsl')

/** Arguments for the star-field vignette node. */
export interface SFVignetteNodeArgs {
  /** Fn argument-object constraint — nodes are opaque to the index. */
  readonly [key: string]: unknown
  /** Incoming scene color (rgba). */
  color: Node<'vec4'>
  /** Screen-space uv (0..1). */
  uv: Node<'vec2'>
  /** Curve exponent + lerp weight combined (photographic feel). */
  darkness: Node<'float'>
  /** Radial reach — higher pulls the falloff toward center. */
  offset: Node<'float'>
}

/**
 * Builds the vignette node used at the end of the post chain.
 *
 * Math:
 *   d = |uv − 0.5|·2  → 0 at center, ~1.41 at corners.
 *   v = 1 − |d|·offset, clamped → linear falloff scaled by reach.
 *   factor = mix(1, v^darkness, min(darkness,1)) → darkness doubles as
 *   curve exponent and amount so a single value feels photographic.
 *
 * @param TSL The three/tsl namespace (lazy-loaded in bootstrap).
 * @returns The vignette Fn ready to wrap a color node.
 */
export function makeSFVignetteNode(TSL: TslNs) {
  const { Fn, vec4, float, max, mix, min } = TSL

  return Fn<SFVignetteNodeArgs, Node<'vec4'>>(
    ({ color, uv, darkness, offset }: SFVignetteNodeArgs) => {
      const d = uv.sub(0.5).abs().mul(2.0)

      const v = float(1.0).sub(d.length().mul(offset)).clamp(0.0, 1.0)

      const factor = mix(float(1.0), v.pow(max(darkness, float(0.001))), min(darkness, float(1.0)))

      return vec4(color.rgb.mul(factor), color.a)
    }
  )
}
