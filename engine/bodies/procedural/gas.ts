/**
 * @file engine/bodies/procedural/gas.ts
 * @description Seeded wispy nebula-gas texture for photo-less nebulae
 * and clusters — a union of soft colored lobes with dark absorption
 * wisps punched through, so the body reads as sculpted gas rather than
 * a uniform glow disc. Split out of procedural.ts; deterministic via
 * `${id}:gas`.
 */
import type * as THREE_NS from 'three'
import { CANVAS_STRINGS } from '@core/tokens/strings/canvas.js'
import { lcg, seedFrom } from '../../rand.js'
import type { SFBodyDef } from '../../types.js'
import { blob, css, GAS_PX, rgb, shade, texCanvas } from './shared.js'
import type { ThreeModule } from './shared.js'

/**
 * Generates a seeded wispy nebula-gas texture for photo-less nebulae
 * and clusters — a union of soft colored lobes (derived from the
 * catalog tint, pushed hot at the cores) with dark absorption wisps
 * punched through, so the body reads as sculpted gas rather than a
 * uniform glow disc. Returns undefined without a 2d context.
 * @param THREE The three.js module.
 * @param def Nebula def (color = gas tint, id = seed).
 * @returns A CanvasTexture for the sprite map, or undefined.
 */
export function gasFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const c = texCanvas(GAS_PX, GAS_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:gas`))
  const mid = GAS_PX / 2

  // 4–7 lobes clustered near center — union reads as a cloud, not a ball.
  const lobes = 4 + Math.floor(rand() * 4)

  for (let i = 0; i < lobes; i++) {
    const ang = rand() * Math.PI * 2
    const d = mid * rand() * 0.45
    const r = mid * (0.35 + rand() * 0.45)

    // Each lobe drifts slightly along the palette: brighter toward the
    // dense center knots, cooler at the fringes.
    const heat = 0.15 + rand() * 0.45

    blob(
      ctx,
      GAS_PX,
      GAS_PX,
      mid + Math.cos(ang) * d,
      mid + Math.sin(ang) * d,
      r,
      css(shade(base, heat), 0.6),
      css(base, 0)
    )
  }

  // A hot core knot — embedded stars ionize the densest lobe.
  blob(ctx, GAS_PX, GAS_PX, mid, mid, mid * 0.22, css(shade(base, 0.85), 0.85), css(base, 0))

  // Absorption wisps — dark gas lanes cut through the bright lobes:
  // destination-out erases a couple of soft streaks so the cloud has
  // real structure instead of uniform emission.
  ctx.globalCompositeOperation = CANVAS_STRINGS.COMPOSITE_DESTINATION_OUT

  const wisps = 2 + Math.floor(rand() * 2)

  for (let i = 0; i < wisps; i++) {
    const x0 = mid + (rand() - 0.5) * mid
    const y0 = mid + (rand() - 0.5) * mid
    const len = mid * (0.5 + rand() * 0.6)
    const ang = rand() * Math.PI

    const x1 = x0 + Math.cos(ang) * len
    const y1 = y0 + Math.sin(ang) * len

    const g = ctx.createLinearGradient(x0, y0, x1, y1)

    g.addColorStop(0, css(shade(base, 0), 0))
    g.addColorStop(0.5, css(shade(base, 0), 0.5))
    g.addColorStop(1, css(shade(base, 0), 0))

    ctx.strokeStyle = g
    ctx.lineWidth = 6 + rand() * 10

    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }

  ctx.globalCompositeOperation = CANVAS_STRINGS.COMPOSITE_SOURCE_OVER

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}
