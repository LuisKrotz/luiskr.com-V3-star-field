/**
 * @file engine/bodies/procedural/corona.ts
 * @description Seeded star-corona sprite — the "alive" layer that turns
 * a lit disc into a sun: a warm atmospheric halo, a hot photosphere
 * knot, irregular flare knots, blob-chain prominence filaments, and
 * H-alpha eruption plumes on magnetically active stars. Split out of
 * procedural.ts; deterministic via `${id}:corona`.
 */
import type * as THREE_NS from 'three'
import { CANVAS_STRINGS } from '@core/tokens/strings/canvas.js'
import { SF_COLORS, SF_DETAIL } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../../rand.js'
import type { SFBodyDef } from '../../types.js'
import { blob, css, rgb, shade, SPRITE_PX, texCanvas } from './shared.js'
import type { ThreeModule } from './shared.js'

/**
 * Corona recipe — all sprite-space fractions of the half-edge. Light,
 * not geometry: stroked lines and wedges read as drawn rays no matter
 * how soft their gradient, so the corona is now layered luminance only —
 * a wide atmospheric halo, a hot photosphere knot, irregular flare
 * knots at the limb, and prominence filaments built as CHAINS of
 * shrinking soft blobs along a curved magnetic-loop path (each link a
 * radial gradient — nothing with a hard edge survives to crayon).
 */
const _CORONA_HALO_R = 0.92
const _CORONA_HALO_ALPHA = 0.34
/** Halo/photosphere shade factors — low values keep the body's own tint
 *  saturated; shading far toward white washed coronas into gray fog. */
const _CORONA_HALO_SHADE = 0.2
const _CORONA_CORE_R = 0.32
const _CORONA_CORE_ALPHA = 0.9
const _CORONA_CORE_SHADE = 0.6
/** Chromatic limb wash — refracted blue light spread through a broad,
 *  shallow gradient (no distinct ring — a thin annulus renders as a
 *  rainbow eye at small sprite sizes). */
const _CORONA_FRINGE_R = 0.8
const _CORONA_FRINGE_STOP = 0.45
const _CORONA_FRINGE_ALPHA = 0.05
const _CORONA_KNOT_MIN = 5
const _CORONA_KNOT_VAR = 5
const _CORONA_KNOT_R0 = 0.5
const _CORONA_KNOT_RVAR = 0.22
const _CORONA_KNOT_SIZE = 0.05
const _CORONA_KNOT_SIZE_VAR = 0.07
const _CORONA_KNOT_ALPHA = 0.5
const _CORONA_KNOT_ALPHA_VAR = 0.3
const _CORONA_WISP_MIN = 8
const _CORONA_WISP_VAR = 5
const _CORONA_WISP_R0 = 0.28
const _CORONA_WISP_RVAR = 0.16
const _CORONA_WISP_BEND = 1.4
const _CORONA_WISP_REACH = 0.14
const _CORONA_WISP_ALPHA = 0.4
/** Blobs per prominence filament — enough to fuse into one curve. */
const _CORONA_WISP_STEPS = 6
/** Blob radius at the limb root of a filament (fraction of mid). */
const _CORONA_WISP_BR = 0.045
/** How much the filament thins toward its tip (0..1). */
const _CORONA_WISP_TAPER = 0.6
/** Activity threshold above which a star throws eruption plumes —
 *  quiet dwarfs (≤1.2) keep only gentle limb prominences. */
const _CORONA_PLUME_MIN = 1.2
/** Plume count base/variance, reach multiplier vs normal wisps, extra
 *  bend (ejecta whips harder), blob size/alpha at the arc root. */
const _CORONA_PLUME_COUNT = 2
const _CORONA_PLUME_REACH = 2.2
const _CORONA_PLUME_BEND = 1.6
const _CORONA_PLUME_BR = 0.06
const _CORONA_PLUME_ALPHA = 0.55

/** Corona photosphere cutout — inner mask radius (×ball radius) and
 *  outer feather edge: inside the sphere is cleared to transparent,
 *  and the fade ends just past the limb so a slim chromosphere ring
 *  survives. */
const _CORONA_CUT_IN = 0.55
const _CORONA_CUT_OUT = 0.95

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
  const c = texCanvas(SPRITE_PX, SPRITE_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:corona`))
  const mid = SPRITE_PX / 2

  // Atmospheric halo — a broad, very soft radial wash reaching the
  // sprite edge. Kept near the body's own tint (low shade factor):
  // shading far toward white desaturates the wash into the gray fog
  // that made coronas read as dusty balloons instead of warm light.
  blob(
    ctx,
    SPRITE_PX,
    SPRITE_PX,
    mid,
    mid,
    mid * _CORONA_HALO_R,
    css(shade(base, _CORONA_HALO_SHADE), _CORONA_HALO_ALPHA),
    css(base, 0)
  )

  // Photosphere knot — the tight hot center the prominences emerge
  // from; shaded well under white so it stays a luminous gold core.
  blob(
    ctx,
    SPRITE_PX,
    SPRITE_PX,
    mid,
    mid,
    mid * _CORONA_CORE_R,
    css(shade(base, _CORONA_CORE_SHADE), _CORONA_CORE_ALPHA),
    css(base, 0)
  )

  // Refractive fringe — a thin chromatic ring just outside the
  // photosphere knot: starlight grazing the chromosphere refracts
  // blue-ward (the same physics that rims Earth's limb in eclipse
  // photos), so a cool band here is what sells "light passing through
  // an atmosphere" instead of a painted disc. The gradient inner radius
  // starts at the core so the ring peaks just beyond it and dies
  // outward into the halo.
  const fringe = ctx.createRadialGradient(
    mid,
    mid,
    mid * _CORONA_CORE_R,
    mid,
    mid,
    mid * _CORONA_FRINGE_R
  )

  fringe.addColorStop(0, css(base, 0))
  fringe.addColorStop(_CORONA_FRINGE_STOP, css(rgb(SF_COLORS.STAR_BLUE), _CORONA_FRINGE_ALPHA))
  fringe.addColorStop(1, css(base, 0))

  ctx.fillStyle = fringe
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX)

  // Activity scale — quiet dwarfs (activity ≈1) get the baseline knot/
  // prominence field; active stars multiply counts and reaches so their
  // coronas boil farther off the limb.
  const act = def.activity ?? 1

  // Flare knots — small soft prominences seeded around the limb: each a
  // tight radial blob, unevenly sized and spaced, so the corona edge
  // boils irregularly like real chromospheric eruptions rather than
  // radiating straight spokes. Bright cores fade outward.
  const knots = Math.round((_CORONA_KNOT_MIN + Math.floor(rand() * _CORONA_KNOT_VAR)) * act)

  for (let i = 0; i < knots; i++) {
    const ang = rand() * Math.PI * 2
    const r0 = mid * (_CORONA_KNOT_R0 + rand() * _CORONA_KNOT_RVAR)
    const size = mid * (_CORONA_KNOT_SIZE + rand() * _CORONA_KNOT_SIZE_VAR)
    const alpha = _CORONA_KNOT_ALPHA + rand() * _CORONA_KNOT_ALPHA_VAR

    blob(
      ctx,
      SPRITE_PX,
      SPRITE_PX,
      mid + Math.cos(ang) * r0,
      mid + Math.sin(ang) * r0,
      size,
      css(shade(base, 0.8), Math.min(1, alpha)),
      css(base, 0)
    )
  }

  // Prominences — arcs of plasma riding curved magnetic loops off the
  // limb. Each filament is a chain of soft radial blobs sampled along a
  // quadratic bend (never a stroke — a stroked path keeps a crisp edge
  // and reads as a drawn line); links shrink and fade toward the tip so
  // the eruption dissolves into the halo like real ejecta.
  const wisps = Math.round((_CORONA_WISP_MIN + Math.floor(rand() * _CORONA_WISP_VAR)) * act)

  for (let i = 0; i < wisps; i++) {
    const ang = rand() * Math.PI * 2
    const r0 = mid * (_CORONA_WISP_R0 + rand() * _CORONA_WISP_RVAR)
    const bend = (rand() - 0.5) * _CORONA_WISP_BEND
    const reach = mid * (_CORONA_WISP_REACH + rand() * _CORONA_WISP_RVAR) * act

    const x0 = mid + Math.cos(ang) * r0
    const y0 = mid + Math.sin(ang) * r0
    const x1 = mid + Math.cos(ang + bend * 0.5) * (r0 + reach * 0.5)
    const y1 = mid + Math.sin(ang + bend * 0.5) * (r0 + reach * 0.5)
    const x2 = mid + Math.cos(ang + bend) * (r0 + reach)
    const y2 = mid + Math.sin(ang + bend) * (r0 + reach)

    for (let k = 0; k < _CORONA_WISP_STEPS; k++) {
      const t = k / (_CORONA_WISP_STEPS - 1)
      const u = 1 - t
      const px = u * u * x0 + 2 * u * t * x1 + t * t * x2
      const py = u * u * y0 + 2 * u * t * y1 + t * t * y2
      const br = mid * _CORONA_WISP_BR * (1 - t * _CORONA_WISP_TAPER)

      blob(
        ctx,
        SPRITE_PX,
        SPRITE_PX,
        px,
        py,
        br,
        css(shade(base, 0.7), _CORONA_WISP_ALPHA * (1 - t)),
        css(base, 0)
      )
    }
  }

  // Eruption plumes — active stars (activity > _CORONA_PLUME_MIN) throw
  // taller arcs of ejecta: the same quadratic blob-chain but reaching
  // ~2× farther off the limb, bent harder, and tinted STAR_FLARE — the
  // hydrogen-alpha orange-red of real prominence plasma — so eruptions
  // read as hot gas distinct from the golden photosphere glow.
  if (act > _CORONA_PLUME_MIN) {
    const plumes = _CORONA_PLUME_COUNT + Math.floor(rand() * _CORONA_PLUME_COUNT)
    const flare = rgb(SF_COLORS.STAR_FLARE)

    for (let i = 0; i < plumes; i++) {
      const ang = rand() * Math.PI * 2
      const r0 = mid * _CORONA_CORE_R
      const bend = (rand() - 0.5) * _CORONA_WISP_BEND * _CORONA_PLUME_BEND
      const reach =
        mid * (_CORONA_WISP_REACH + rand() * _CORONA_WISP_RVAR) * _CORONA_PLUME_REACH * act

      const x0 = mid + Math.cos(ang) * r0
      const y0 = mid + Math.sin(ang) * r0
      const x1 = mid + Math.cos(ang + bend * 0.5) * (r0 + reach * 0.5)
      const y1 = mid + Math.sin(ang + bend * 0.5) * (r0 + reach * 0.5)
      const x2 = mid + Math.cos(ang + bend) * (r0 + reach)
      const y2 = mid + Math.sin(ang + bend) * (r0 + reach)

      for (let k = 0; k < _CORONA_WISP_STEPS; k++) {
        const t = k / (_CORONA_WISP_STEPS - 1)
        const u = 1 - t
        const px = u * u * x0 + 2 * u * t * x1 + t * t * x2
        const py = u * u * y0 + 2 * u * t * y1 + t * t * y2
        const br = mid * _CORONA_PLUME_BR * (1 - t * _CORONA_WISP_TAPER)

        blob(
          ctx,
          SPRITE_PX,
          SPRITE_PX,
          px,
          py,
          br,
          css(shade(flare, 0.25), _CORONA_PLUME_ALPHA * (1 - t)),
          css(flare, 0)
        )
      }
    }
  }

  // Photosphere cutout — the corona lives OUTSIDE the disc: a soft
  // destination-out mask clears the sprite's center where the sphere
  // renders, so the glow hugs the limb like a real corona instead of
  // additively washing the face to white. The radius mirrors the
  // sprite-scale math in bodies-scene (CORONA_SCALE × activity), and a
  // feathered edge keeps a slim bright ring at the chromosphere.
  const ballR = (mid * 2) / (SF_DETAIL.CORONA_SCALE * act)

  ctx.globalCompositeOperation = CANVAS_STRINGS.COMPOSITE_DESTINATION_OUT

  const mask = ctx.createRadialGradient(
    mid,
    mid,
    ballR * _CORONA_CUT_IN,
    mid,
    mid,
    ballR * _CORONA_CUT_OUT
  )

  mask.addColorStop(0, css(base, 1))
  mask.addColorStop(1, css(base, 0))

  ctx.fillStyle = mask
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX)
  ctx.globalCompositeOperation = CANVAS_STRINGS.COMPOSITE_SOURCE_OVER

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}
