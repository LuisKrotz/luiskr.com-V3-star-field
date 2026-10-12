/**
 * @file engine/bodies/procedural/surface.ts
 * @description Seeded equirect surface textures for untextured solid
 * bodies — planets, moons, dwarf planets and rocky exoplanet
 * satellites each get a distinct surface (mottling, latitude bands,
 * crater fields, ice streaks) instead of a flat tint. Split out of
 * procedural.ts; everything is deterministic via the body id.
 */
import type * as THREE_NS from 'three'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { lcg, seedFrom } from '../../rand.js'
import type { SFBodyDef } from '../../types.js'
import { blob, css, rgb, shade, SURFACE_H, SURFACE_W, texCanvas } from './shared.js'
import type { ThreeModule, Rgb } from './shared.js'

/** Surface style buckets — how the generator dresses a body. */
const _STYLE_MOTTLE = 0
const _STYLE_BANDS = 1
const _STYLE_STREAKS = 2

/**
 * Picks the surface style for a body: moons and dwarf planets are
 * cratered rock; gas-rich exoplanet-sized bodies favor latitude bands;
 * icy surfaces favor bright streaks. The seed decides within each
 * kind's bias so two bodies of the same kind still differ.
 * @param def Body def.
 * @param rand Seeded RNG.
 */
function surfaceStyle(def: SFBodyDef, rand: () => number): number {
  if (def.kind === SF_KINDS.MOON || def.kind === SF_KINDS.DWARF) {
    // Rocky bodies — mostly cratered mottle, an occasional icy streaked
    // surface (Europa/Enceladus-like).
    return rand() < 0.25 ? _STYLE_STREAKS : _STYLE_MOTTLE
  }

  const pick = rand()

  return pick < 0.4 ? _STYLE_BANDS : pick < 0.8 ? _STYLE_MOTTLE : _STYLE_STREAKS
}

/**
 * Fills the equirect canvas with the body's base color plus seeded
 * large-scale mottling — continental-scale albedo patches so the sphere
 * never reads as a single flat tint.
 * @param ctx 2d context (SURFACE_W×SURFACE_H).
 * @param base Body channel triple.
 * @param rand Seeded RNG.
 * @param patches Blob count — moons/dwarfs are heavily mottled.
 */
function mottle(
  ctx: CanvasRenderingContext2D,
  base: Rgb,
  rand: () => number,
  patches: number
): void {
  for (let i = 0; i < patches; i++) {
    const light = rand() < 0.5

    const k = 0.06 + rand() * 0.14

    const x = rand() * SURFACE_W
    const y = rand() * SURFACE_H
    const r = SURFACE_H * (0.08 + rand() * 0.3)

    blob(ctx, SURFACE_W, SURFACE_H, x, y, r, css(shade(base, light ? k : -k), 0.5), css(base, 0))
  }
}

/**
 * Crater field — small dark discs with a brighter rim offset, the
 * signature of an airless rocky surface at texture-zoom. Only painted
 * for MOON/DWARF kinds.
 * @param ctx 2d context.
 * @param base Body channel triple.
 * @param rand Seeded RNG.
 * @param count Crater count.
 */
function craters(
  ctx: CanvasRenderingContext2D,
  base: Rgb,
  rand: () => number,
  count: number
): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * SURFACE_W
    const y = rand() * SURFACE_H
    const r = 1.5 + rand() * 5

    // Shadowed bowl first, then a lit-rim arc nudged sunward.
    blob(ctx, SURFACE_W, SURFACE_H, x, y, r, css(shade(base, -0.3), 0.55), css(base, 0))
    blob(
      ctx,
      SURFACE_W,
      SURFACE_H,
      x - r * 0.25,
      y - r * 0.25,
      r * 0.6,
      css(shade(base, 0.25), 0.4),
      css(base, 0)
    )
  }
}

/**
 * Latitude bands — jittered horizontal stripes for gas giants; edge
 * wobble via sinusoidal offsets so the bands read as turbulent jet
 * streams, not a barcode.
 * @param ctx 2d context.
 * @param base Body channel triple.
 * @param rand Seeded RNG.
 */
function bands(ctx: CanvasRenderingContext2D, base: Rgb, rand: () => number): void {
  const rows = 7 + Math.floor(rand() * 6)

  for (let i = 0; i < rows; i++) {
    const y0 = (i / rows) * SURFACE_H
    const h = SURFACE_H / rows

    const light = i % 2 === 0
    const k = 0.08 + rand() * 0.12

    ctx.fillStyle = css(shade(base, light ? k : -k), 0.65)

    const wobble = rand() * Math.PI * 2
    const amp = h * (0.3 + rand() * 0.6)

    // Draw the band as a wavy strip: two sine-shifted row segments.
    for (let x = 0; x < SURFACE_W; x += 8) {
      const dy = Math.sin((x / SURFACE_W) * Math.PI * 4 + wobble) * amp

      ctx.fillRect(x, y0 + dy, 8, h)
    }
  }
}

/**
 * Ice streaks — long bright diagonal cracks over the base, the Europa/
 * Enceladus look: a handful of soft bright gradients at seeded angles.
 * @param ctx 2d context.
 * @param base Body channel triple.
 * @param rand Seeded RNG.
 */
function streaks(ctx: CanvasRenderingContext2D, base: Rgb, rand: () => number): void {
  const n = 3 + Math.floor(rand() * 4)

  for (let i = 0; i < n; i++) {
    const x0 = rand() * SURFACE_W
    const y0 = rand() * SURFACE_H
    const len = SURFACE_W * (0.3 + rand() * 0.6)
    const ang = rand() * Math.PI

    const x1 = x0 + Math.cos(ang) * len
    const y1 = y0 + Math.sin(ang) * len

    const g = ctx.createLinearGradient(x0, y0, x1, y1)

    const bright = css(shade(base, 0.35), 0.5)

    g.addColorStop(0, css(base, 0))
    g.addColorStop(0.5, bright)
    g.addColorStop(1, css(base, 0))

    ctx.strokeStyle = g
    ctx.lineWidth = 1 + rand() * 3

    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
}

/**
 * Generates a seeded equirect surface texture for an untextured solid
 * body — planets, moons, dwarf planets and rocky exoplanet satellites
 * all get a distinct surface instead of a flat tint. Returns undefined
 * when no 2d context exists so the caller keeps the plain material.
 * @param THREE The three.js module.
 * @param def Body def (color = base tint, id = seed).
 * @returns A CanvasTexture for `material.map`, or undefined.
 */
export function surfaceFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const c = texCanvas(SURFACE_W, SURFACE_H)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(def.id))

  ctx.fillStyle = css(base, 1)
  ctx.fillRect(0, 0, SURFACE_W, SURFACE_H)

  const style = surfaceStyle(def, rand)

  // Mottling underlies every style — even banded giants have storms.
  mottle(ctx, base, rand, style === _STYLE_BANDS ? 14 : 26)

  if (style === _STYLE_BANDS) bands(ctx, base, rand)

  if (style === _STYLE_STREAKS) streaks(ctx, base, rand)

  if (def.kind === SF_KINDS.MOON || def.kind === SF_KINDS.DWARF) {
    craters(ctx, base, rand, 10 + Math.floor(rand() * 14))
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}
