/**
 * @file engine/bodies/procedural/spikes.ts
 * @description Seeded diffraction-spike starburst — the optical cross
 * real telescopes paint over bright point sources. Spikes are soft
 * elliptical gradients (an anisotropically scaled radial blob — never a
 * stroked line, per the corona rule), six rays like a segmented-mirror
 * scope plus a faint rotated second cross for depth. Deterministic via
 * `${id}:spikes`.
 */
import type * as THREE_NS from 'three'
import { SF_SPIKE } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../../rand.js'
import type { SFBodyDef } from '../../types.js'
import { css, rgb, shade, SPRITE_PX, texCanvas } from './shared.js'
import type { ThreeModule } from './shared.js'

/** Half-turn divisor mapping ray index → angle. */
const _SPIKE_HALF_TURN = 2

/**
 * Paints one spike ray — a radial gradient squeezed along its length so
 * the streak keeps a gaussian cross-section and melts at both ends.
 * @param ctx 2d context.
 * @param mid Canvas center in px.
 * @param ang Ray angle in radians.
 * @param len Ray half-length in px.
 * @param thin Ray half-width as a fraction of len.
 * @param inner Inner css color (hot core).
 * @param outer Outer css color (alpha 0 tail).
 */
function spikeRay(
  ctx: CanvasRenderingContext2D,
  mid: number,
  ang: number,
  len: number,
  thin: number,
  inner: string,
  outer: string
): void {
  ctx.save()

  ctx.translate(mid, mid)
  ctx.rotate(ang)

  // Squash the cross-axis so a radial gradient becomes a thin streak —
  // the gradient is still round inside its own space, so both ends and
  // both edges feather with no hard line anywhere.
  ctx.scale(1, thin)

  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len / thin)

  g.addColorStop(0, inner)
  g.addColorStop(1, outer)

  ctx.fillStyle = g
  ctx.fillRect(0, -len / thin, len, (len * 2) / thin)

  ctx.restore()
}

/**
 * Generates a seeded diffraction-spike sprite — six primary rays (the
 * hexagonal cross of a segmented mirror) plus a fainter, shorter second
 * cross rotated a quarter-turn offset so the burst reads optical, not
 * drawn. A tight center knot anchors the burst on the photosphere.
 * @param THREE The three.js module.
 * @param def Star def (color = spike tint, id = seed).
 * @returns A CanvasTexture for the spike sprite map, or undefined.
 */
export function spikesFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const c = texCanvas(SPRITE_PX, SPRITE_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:spikes`))
  const mid = SPRITE_PX / 2

  // Seeded base rotation — every star's cross lands at its own angle so
  // neighbouring bright stars don't stamp identical crosses.
  const baseAng = rand() * Math.PI

  const hot = css(shade(base, 0.85), 0.9)
  const cold = css(base, 0)
  const len = mid

  for (let i = 0; i < SF_SPIKE.SPIKE_RAYS; i++) {
    const ang =
      baseAng +
      (i * Math.PI * _SPIKE_HALF_TURN) / SF_SPIKE.SPIKE_RAYS +
      rand() * SF_SPIKE.SPIKE_JITTER

    spikeRay(ctx, mid, ang, len, SF_SPIKE.SPIKE_THIN, hot, cold)
  }

  // Second cross — shorter, dimmer, rotated a quarter-turn step so the
  // burst gains the faint secondary diffraction ring a real scope shows.
  const rot2 = baseAng + Math.PI * SF_SPIKE.SPIKE_ROT2

  for (let i = 0; i < SF_SPIKE.SPIKE_RAYS; i++) {
    const ang = rot2 + (i * Math.PI * _SPIKE_HALF_TURN) / SF_SPIKE.SPIKE_RAYS

    spikeRay(ctx, mid, ang, len * SF_SPIKE.SPIKE_LEN2, SF_SPIKE.SPIKE_THIN * 1.6, hot, cold)
  }

  // Center knot — the small white-hot core the spikes converge on.
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid * SF_SPIKE.SPIKE_CORE)

  g.addColorStop(0, css(shade(base, 1), 1))
  g.addColorStop(1, css(base, 0))

  ctx.fillStyle = g
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX)

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}
