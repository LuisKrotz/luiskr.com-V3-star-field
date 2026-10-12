/**
 * @file engine/bodies/procedural/halo.ts
 * @description Additive star-glow annulus texture — the halo sprite is
 * centered on the disc, so a plain radial gradient piles its brightest
 * ring onto the photosphere and saturates the face to white; the
 * annulus keeps the glow outside the limb with the body's tint baked
 * in. Split out of procedural.ts; textures are memoized per body id.
 */
import type * as THREE_NS from 'three'
import type { SFBodyDef } from '../../types.js'
import { css, rgb, shade, texCanvas } from './shared.js'
import type { ThreeModule } from './shared.js'

/** Annulus halo recipe — the additive star-glow sprite is centered on
 *  the disc, so a plain radial gradient piles its brightest ring onto
 *  the photosphere and saturates the face to white. The annulus stays
 *  transparent where the ball sits (its half-width is 2/HALO_SCALE of
 *  the sprite half — identical for every star because the sprite scales
 *  with the radius) and peaks just past the limb so the glow still
 *  reads as light escaping into space. The body's own tint is baked
 *  into the texture — a SpriteMaterial's `color` channel doesn't
 *  multiply the map under the node pipeline. */
const _HALO_TEX_PX = 256
/** Annulus geometry vs HALO_SCALE (3.6): the photosphere occupies
 *  1/3.6 ≈ 0.28 of the sprite half-extent, so the transparent cut
 *  ends just inside the limb (0.24) and the glow peaks right AT the
 *  limb (0.32) — a peak farther out leaves a dark ring gap between
 *  the ball and its glow that reads as a hollow sphere boundary. */
const _HALO_CUT = 0.24
const _HALO_PEAK = 0.32
const _HALO_PEAK_ALPHA = 0.7
/** Eased tail stops — a linear fade keeps enough alpha near the
 *  texture rim for the sprite to read as a bounded ball; stepped
 *  stops approximate the steep physical glow curve (roughly 1/r²)
 *  so the tail is essentially invisible long before the edge. */
const _HALO_T1 = 0.5
const _HALO_T1_ALPHA = 0.22
const _HALO_T2 = 0.68
const _HALO_T2_ALPHA = 0.06
const _HALO_T3 = 0.85
const _HALO_T3_ALPHA = 0.015

/** Point-glow geometry — a galactic star at honest chart distances is an
 *  unresolvable point of light, so its halo is a filled radial glow: a
 *  white-hot core (~diffraction point) that hands off to the star's
 *  tint and dies through the same eased tail as the annulus. */
const _POINT_CORE = 0.18
const _POINT_CORE_ALPHA = 0.95
const _POINT_MID = 0.34
const _POINT_MID_ALPHA = 0.4

/** Memoized annulus textures — one per body id (the tint is baked in). */
const _haloRings = new Map<string, THREE_NS.Texture>()

/** Memoized point-glow textures — one per body id. */
const _pointGlows = new Map<string, THREE_NS.Texture>()

/**
 * Generates the additive halo sprite texture for a luminous body — a
 * tinted annulus whose transparent center keeps the photosphere crisp
 * while the limb bleeds warm light into space.
 * @param THREE The three.js module.
 * @param def Star def (color tints the ring, id keys the cache).
 * @returns Tinted annulus texture, or undefined.
 */
export function haloFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const cached = _haloRings.get(def.id)

  if (cached) return cached

  const c = texCanvas(_HALO_TEX_PX, _HALO_TEX_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const mid = _HALO_TEX_PX / 2
  const base = rgb(def.color)

  const g = ctx.createRadialGradient(mid, mid, mid * _HALO_CUT, mid, mid, mid)

  g.addColorStop(0, css(base, 0))
  g.addColorStop(_HALO_PEAK, css(shade(base, 0.25), _HALO_PEAK_ALPHA))
  g.addColorStop(_HALO_T1, css(base, _HALO_T1_ALPHA))
  g.addColorStop(_HALO_T2, css(base, _HALO_T2_ALPHA))
  g.addColorStop(_HALO_T3, css(base, _HALO_T3_ALPHA))
  g.addColorStop(1, css(base, 0))

  ctx.fillStyle = g
  ctx.fillRect(0, 0, _HALO_TEX_PX, _HALO_TEX_PX)

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace
  _haloRings.set(def.id, out)

  return out
}

/**
 * Generates the additive halo texture for a point star — a filled
 * radial glow with a white-hot core and the body's tint in the tail.
 * Galactic stars never resolve a photosphere at chart distances, so
 * their whole luminous body is this sprite (no sphere mesh); the
 * annulus would leave a hollow center with nothing inside it.
 * @param THREE The three.js module.
 * @param def Star def (color tints the tail, id keys the cache).
 * @returns Tinted point-glow texture, or undefined.
 */
export function pointGlowFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const cached = _pointGlows.get(def.id)

  if (cached) return cached

  const c = texCanvas(_HALO_TEX_PX, _HALO_TEX_PX)

  if (!c) return undefined

  const { ctx } = c
  const mid = _HALO_TEX_PX / 2
  const base = rgb(def.color)

  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid)

  g.addColorStop(0, css(shade(base, 0.65), _POINT_CORE_ALPHA))
  g.addColorStop(_POINT_CORE, css(shade(base, 0.3), _POINT_MID_ALPHA))
  g.addColorStop(_POINT_MID, css(base, _HALO_T1_ALPHA))
  g.addColorStop(_HALO_T2, css(base, _HALO_T2_ALPHA))
  g.addColorStop(_HALO_T3, css(base, _HALO_T3_ALPHA))
  g.addColorStop(1, css(base, 0))

  ctx.fillStyle = g
  ctx.fillRect(0, 0, _HALO_TEX_PX, _HALO_TEX_PX)

  const out = new THREE.CanvasTexture(ctx.canvas)

  out.colorSpace = THREE.SRGBColorSpace
  _pointGlows.set(def.id, out)

  return out
}
