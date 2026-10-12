/**
 * @file engine/bodies/procedural/shared.ts
 * @description Shared paint primitives for the seeded texture
 * generators — packed-hex → css-rgba helpers, the soft radial blob
 * fill, and the 2d-context factory every generator degrades on.
 * Split out of procedural.ts so each generator file stays a small
 * self-contained module over a common vocabulary.
 */
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { WEBGL_STRINGS } from '@core/tokens/strings/webgl.js'
import { SF_COLORS } from '@core/tokens/starfield/params.js'

/** Three.js module dynamic import type. */
/** Lazy-loaded three.js module — the experiment imports three only
 *  after WebGL probing succeeds, so every helper takes it as a param. */
export type ThreeModule = typeof import('three')

/** RGBA components extracted from a packed hex color. */
export type Rgb = [number, number, number]

/** Equirect surface canvas width — wraps a sphere 2:1 cleanly. */
export const SURFACE_W = 256

/** Equirect surface canvas height — wraps a sphere 2:1 cleanly. */
export const SURFACE_H = 128

/** Sprite texture edge for coronas and nebula gas. */
export const SPRITE_PX = 256

/** Gas sprite canvas edge in pixels. */
export const GAS_PX = 384

/**
 * Unpacks a packed hex color into `[r, g, b]` channel floats (0–255) —
 * the canvas API wants css-rgba() strings, not three hex ints.
 * @param hex Packed color int (may be undefined → neutral grey fallback
 *   matching the catalog's default body tint).
 * @returns Channel triple.
 */
export function rgb(hex: number | undefined): Rgb {
  const c = hex ?? SF_COLORS.BODY_NEUTRAL

  return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
}

/**
 * `rgba()` css string for a channel triple + alpha.
 * @param c Channel triple.
 * @param a Alpha 0–1.
 */
export function css(c: Rgb, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
}

/**
 * Scales a channel triple toward white (`k > 0`) or black (`k < 0`) —
 * crater rims, band highlights and corona streamers all derive from the
 * body's own palette instead of carrying their own literals.
 * @param c Base channel triple.
 * @param k Shift −1..1.
 * @returns Shifted triple.
 */
export function shade(c: Rgb, k: number): Rgb {
  const t = k > 0 ? 255 : 0

  const m = Math.abs(k)

  return [c[0] + (t - c[0]) * m, c[1] + (t - c[1]) * m, c[2] + (t - c[2]) * m]
}

/**
 * Creates a canvas + 2d context for texture generation, or null when
 * the environment has no 2d (headless probes, blocked canvas) — every
 * caller keeps its previous fallback in that case.
 * @param w Canvas width px.
 * @param h Canvas height px.
 */
export function texCanvas(
  w: number,
  h: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement(HTML_TAGS.CANVAS)

  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext(WEBGL_STRINGS.CONTEXT_2D)

  return ctx ? { canvas, ctx } : null
}

/**
 * Soft radial blob fill — the shared paint primitive: mottle patches,
 * craters, gas lobes and flare knots are all radial gradients punched
 * into the canvas at a point.
 * @param ctx 2d context.
 * @param x Center x.
 * @param y Center y.
 * @param r Blob radius px.
 * @param inner Inner-stop css color.
 * @param outer Outer-stop css color (usually alpha 0).
 */
export function blob(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  inner: string,
  outer: string
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)

  g.addColorStop(0, inner)
  g.addColorStop(1, outer)

  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}
