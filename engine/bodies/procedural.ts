/**
 * @file engine/bodies/procedural.ts
 * @description Seeded canvas texture generation for bodies with no real
 * imagery. Real photographs only exist for ~25 of the catalog's bodies;
 * everything else (moons, dwarf planets, exoplanets, stars without a
 * photosphere map, nebulae without a Hubble plate) used to render as a
 * flat tinted primitive — the "nonsensical circles" failure. These
 * generators draw each body's surface/clouds/corona procedurally so
 * every untextured body still reads as a distinct astronomical object:
 *
 *   `surfaceFor` — 2:1 equirect surface map: seeded mottling, latitude
 *                  bands on gas giants, and crater fields on rocky
 *                  moons/dwarf planets.
 *   `coronaFor`  — star corona sprite: seeded radial streamers and
 *                  flare knots over a warm photosphere glow, so stars
 *                  read as live suns rather than lit discs.
 *   `gasFor`     — wispy nebula gas: a seeded union of colored lobes
 *                  with dark absorption wisps, so photo-less nebulae
 *                  still look like gas clouds instead of a glow blob.
 *
 * Everything is deterministic (seeded from the body id via `lcg`), so a
 * body looks identical on every visit, and every generator degrades to
 * `undefined` when no 2d context exists (headless probes) so callers
 * keep their previous glow fallback.
 */
import type * as THREE_NS from 'three'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { WEBGL_STRINGS } from '@core/tokens/strings/webgl.js'
import { CANVAS_STRINGS } from '@core/tokens/strings/canvas.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { SF_COLORS } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../rand.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

/** RGBA components extracted from a packed hex color. */
type Rgb = [number, number, number]

/** Equirect surface canvas edge — wraps a sphere 2:1 cleanly. */
const _SURFACE_W = 256
const _SURFACE_H = 128

/** Sprite texture edge for coronas and nebula gas. */
const _SPRITE_PX = 256
const _GAS_PX = 384

/** Surface style buckets — how the generator dresses a body. */
const _STYLE_MOTTLE = 0
const _STYLE_BANDS = 1
const _STYLE_STREAKS = 2

/**
 * Unpacks a packed hex color into `[r, g, b]` channel floats (0–255) —
 * the canvas API wants css-rgba() strings, not three hex ints.
 * @param hex Packed color int (may be undefined → neutral grey fallback
 *   matching the catalog's default body tint).
 * @returns Channel triple.
 */
function rgb(hex: number | undefined): Rgb {
  const c = hex ?? SF_COLORS.BODY_NEUTRAL

  return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
}

/**
 * `rgba()` css string for a channel triple + alpha.
 * @param c Channel triple.
 * @param a Alpha 0–1.
 */
function css(c: Rgb, a: number): string {
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
function shade(c: Rgb, k: number): Rgb {
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
function texCanvas(
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
function blob(
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

    const x = rand() * _SURFACE_W
    const y = rand() * _SURFACE_H
    const r = _SURFACE_H * (0.08 + rand() * 0.3)

    blob(ctx, _SURFACE_W, _SURFACE_H, x, y, r, css(shade(base, light ? k : -k), 0.5), css(base, 0))
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
    const x = rand() * _SURFACE_W
    const y = rand() * _SURFACE_H
    const r = 1.5 + rand() * 5

    // Shadowed bowl first, then a lit-rim arc nudged sunward.
    blob(ctx, _SURFACE_W, _SURFACE_H, x, y, r, css(shade(base, -0.3), 0.55), css(base, 0))
    blob(
      ctx,
      _SURFACE_W,
      _SURFACE_H,
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
    const y0 = (i / rows) * _SURFACE_H
    const h = _SURFACE_H / rows

    const light = i % 2 === 0
    const k = 0.08 + rand() * 0.12

    ctx.fillStyle = css(shade(base, light ? k : -k), 0.65)

    const wobble = rand() * Math.PI * 2
    const amp = h * (0.3 + rand() * 0.6)

    // Draw the band as a wavy strip: two sine-shifted row segments.
    for (let x = 0; x < _SURFACE_W; x += 8) {
      const dy = Math.sin((x / _SURFACE_W) * Math.PI * 4 + wobble) * amp

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
    const x0 = rand() * _SURFACE_W
    const y0 = rand() * _SURFACE_H
    const len = _SURFACE_W * (0.3 + rand() * 0.6)
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
  const c = texCanvas(_SURFACE_W, _SURFACE_H)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(def.id))

  ctx.fillStyle = css(base, 1)
  ctx.fillRect(0, 0, _SURFACE_W, _SURFACE_H)

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

/**
 * Generates a seeded star-corona sprite — the "alive" layer that turns
 * a lit disc into a sun: a warm photosphere glow, seeded radial
 * streamers at uneven lengths, and a few flare knots. The sprite
 * rotates slowly in `updateFx` so the streamers shimmer.
 * @param THREE The three.js module.
 * @param def Star def (color = streamer tint, id = seed).
 * @returns A CanvasTexture for the corona sprite map, or undefined.
 */
export function coronaFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const c = texCanvas(_SPRITE_PX, _SPRITE_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:corona`))
  const mid = _SPRITE_PX / 2

  // Photosphere glow — a TIGHT hot center; a full-extent blob paints a
  // big colored bubble around the star instead of a corona.
  blob(ctx, _SPRITE_PX, _SPRITE_PX, mid, mid, mid * 0.42, css(shade(base, 0.8), 0.9), css(base, 0))

  // Radial streamers — thin bright fans at seeded angles; unequal
  // lengths keep it organic, and rotation animates the shimmer.
  const streaksN = 12 + Math.floor(rand() * 7)

  for (let i = 0; i < streaksN; i++) {
    const ang = (i / streaksN) * Math.PI * 2 + rand() * 0.4
    const len = mid * (0.6 + rand() * 0.4)

    const x1 = mid + Math.cos(ang) * len
    const y1 = mid + Math.sin(ang) * len

    const g = ctx.createLinearGradient(mid, mid, x1, y1)

    g.addColorStop(0, css(shade(base, 0.65), 0.7))
    g.addColorStop(1, css(base, 0))

    ctx.strokeStyle = g
    ctx.lineWidth = 1.5 + rand() * 4

    ctx.beginPath()
    ctx.moveTo(mid, mid)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }

  // Flare knots — small bright clumps riding a few streamers.
  const knots = 2 + Math.floor(rand() * 3)

  for (let i = 0; i < knots; i++) {
    const ang = rand() * Math.PI * 2
    const d = mid * (0.4 + rand() * 0.4)

    blob(
      ctx,
      _SPRITE_PX,
      _SPRITE_PX,
      mid + Math.cos(ang) * d,
      mid + Math.sin(ang) * d,
      mid * (0.05 + rand() * 0.08),
      css(shade(base, 0.8), 0.7),
      css(base, 0)
    )
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}

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
  const c = texCanvas(_GAS_PX, _GAS_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:gas`))
  const mid = _GAS_PX / 2

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
      _GAS_PX,
      _GAS_PX,
      mid + Math.cos(ang) * d,
      mid + Math.sin(ang) * d,
      r,
      css(shade(base, heat), 0.6),
      css(base, 0)
    )
  }

  // A hot core knot — embedded stars ionize the densest lobe.
  blob(ctx, _GAS_PX, _GAS_PX, mid, mid, mid * 0.22, css(shade(base, 0.85), 0.85), css(base, 0))

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
