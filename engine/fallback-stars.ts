/**
 * @file engine/fallback-stars.ts
 * @description Static 2D-canvas starfield for the no-WebGL fallback —
 * painted once (and on resize) so a denied/failed GPU still shows a real
 * deep-space chart instead of a bare gradient veil. Seeded with the same
 * `lcg`/`seedFrom` pair the engine uses, so the fallback field is identical
 * every visit. A densified diagonal band stands in for the Milky Way.
 *
 * One-shot paint — no rAF loop, no GPU. The caller owns the canvas; the
 * returned disposer drops the resize observer.
 */
import { SF_FALLBACK } from '@core/tokens/starfield/params.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { lcg, seedFrom } from './rand.js'

/** One-shot paint of the seeded starfield into the fallback canvas. */
export function paintStarFallback(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')

  if (!ctx) return

  const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth

  const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight

  if (!w || !h) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)

    canvas.height = Math.round(h * dpr)
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.clearRect(0, 0, w, h)

  // Star ink follows the themed surface color — the stylesheet sets
  // `color:` on the fallback element so this reads the --sf-sky-* token.
  const ink = getComputedStyle(canvas).color || 'CanvasText'

  ctx.fillStyle = ink

  ctx.strokeStyle = ink

  const rand = lcg(seedFrom('sf-fallback'))

  // Field stars — exponential magnitude ramp so most are dim pinpoints.
  const count = Math.min(SF_FALLBACK.STAR_MAX, Math.round((w * h) / SF_FALLBACK.STAR_DENSITY))

  for (let i = 0; i < count; i++) {
    const x = rand() * w
    const y = rand() * h
    const mag = rand() * rand() // skew toward faint

    const r = 0.4 + (1 - mag) * (SF_FALLBACK.STAR_SIZE_MAX - 0.4)

    ctx.globalAlpha = SF_FALLBACK.DIM_ALPHA + (1 - mag) * (1 - SF_FALLBACK.DIM_ALPHA)

    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()

    // Sparse diffraction-cross glint on the brightest few percent.
    if (rand() < SF_FALLBACK.GLINT_RATIO) {
      const g = r * 4

      ctx.globalAlpha = 0.5
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(x - g, y)
      ctx.lineTo(x + g, y)
      ctx.moveTo(x, y - g)
      ctx.lineTo(x, y + g)
      ctx.stroke()
    }
  }

  // Milky-way band — micro-stars scattered with gaussian-ish spread around
  // a diagonal axis so the fallback still reads as *our* galaxy.
  const slope = SF_FALLBACK.BAND_TILT

  const halfW = SF_FALLBACK.BAND_WIDTH * h * 0.5

  const cy = h * 0.55

  for (let i = 0; i < SF_FALLBACK.BAND_STARS; i++) {
    const x = rand() * w
    const axisY = cy + (x - w * 0.5) * slope
    const spread = (rand() + rand() + rand() - 1.5) / 1.5 // pseudo-normal [-1,1]

    const y = axisY + spread * halfW

    ctx.globalAlpha = 0.15 + rand() * 0.4
    ctx.beginPath()
    ctx.arc(x, y, 0.3 + rand() * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalAlpha = 1
}

/**
 * Binds the fallback canvas: paints immediately and repaints whenever the
 * element resizes (viewport changes, grid step flips). Returns a disposer
 * for teardown — null when the canvas/observer can't run.
 * @param canvas The `.sf-fallback` canvas element.
 */
export function bindStarFallback(canvas: HTMLCanvasElement): (() => void) | null {
  paintStarFallback(canvas)

  if (typeof ResizeObserver === TYPE_STRINGS.UNDEFINED) return null

  const ro = new ResizeObserver(() => paintStarFallback(canvas))

  try {
    ro.observe(canvas)
  } catch {
    // A non-Element target (tests, exotic hosts) — the one-shot paint
    // already landed; the observer simply can't track it.
    return () => ro.disconnect()
  }

  return () => ro.disconnect()
}
