/**
 * @file engine/bodies/procedural/star-surface.ts
 * @description Seeded equirect photosphere texture for luminous bodies —
 * fine convection-cell granulation over the star's tint plus sunspot
 * groups (umbra/penumbra/facula) on magnetically active stars, so
 * luminous spheres carry a living surface instead of an eggshell disc.
 * Split out of procedural.ts; deterministic via `${id}:photosphere`.
 */
import type * as THREE_NS from 'three'
import { lcg, seedFrom } from '../../rand.js'
import type { SFBodyDef } from '../../types.js'
import { blob, css, rgb, shade, SURFACE_H, SURFACE_W, texCanvas } from './shared.js'
import type { ThreeModule } from './shared.js'

/** Photosphere granulation cell count and contrast — fine convection
 *  cells (the Sun's boiling surface at telescope zoom), not the broad
 *  continental mottling planets get. */
const _GRANULE_COUNT = 420
const _GRANULE_LO = 0.06
const _GRANULE_HI = 0.22
const _GRANULE_R = 0.02
const _GRANULE_RVAR = 0.05
const _GRANULE_ALPHA = 0.55

/** Sunspot field — activity threshold to draw groups, base group count,
 *  active-latitude band (equirect v-fraction), umbra/penumbra radii and
 *  depths, and the facula bright-rim strength. Depths/alpha are chosen
 *  to stay under the fresnel limb so spots read as magnetism, not dirt. */
const _SPOT_MIN = 1.15
const _SPOT_COUNT = 2
const _SPOT_LAT_LO = 0.2
const _SPOT_LAT_HI = 0.6
const _SPOT_PENUMBRA = 0.055
const _SPOT_UMBRA = 0.028
const _SPOT_RVAR = 0.03
const _SPOT_DEPTH = 0.5
const _SPOT_ALPHA = 0.75
const _SPOT_PEN_DEPTH = 0.28
const _SPOT_PEN_ALPHA = 0.4
const _SPOT_FAC_DEPTH = 0.35
const _SPOT_FAC_ALPHA = 0.5

/**
 * Generates a seeded equirect photosphere texture for a luminous body —
 * hundreds of small offset granulation cells modulate the star's tint
 * so the sphere reads as a boiling photosphere (convection granules)
 * rather than a smooth egg; the fresnel material modulates this map
 * into the limb tint at grazing angles, which stands in for limb
 * darkening + refraction. Returns undefined without a 2d context.
 * @param THREE The three.js module.
 * @param def Star def (color = photosphere tint, id = seed).
 * @returns A CanvasTexture for the glow-sphere's color modulate, or undefined.
 */
export function starSurfaceFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const c = texCanvas(SURFACE_W, SURFACE_H)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:photosphere`))

  // Base fill lifted toward cream — the glow material multiplies this
  // map by the body's color, so a full-strength base doubles the tint
  // down to red-orange; a lighter base keeps G-type stars golden.
  ctx.fillStyle = css(shade(base, 0.3), 1)
  ctx.fillRect(0, 0, SURFACE_W, SURFACE_H)

  // Granulation — many small cells at low contrast, alternating bright
  // (rising hot plasma) and dark (cooler sinking lanes), the solar
  // telescope look.
  for (let i = 0; i < _GRANULE_COUNT; i++) {
    const light = rand() < 0.55

    const k = _GRANULE_LO + rand() * _GRANULE_HI

    const x = rand() * SURFACE_W
    const y = rand() * SURFACE_H
    const r = SURFACE_H * (_GRANULE_R + rand() * _GRANULE_RVAR)

    blob(
      ctx,
      SURFACE_W,
      SURFACE_H,
      x,
      y,
      r,
      css(shade(base, light ? k : -k), _GRANULE_ALPHA),
      css(base, 0)
    )
  }

  // Sunspot groups — magnetically active stars carry dark umbrae
  // ringed by softer penumbrae, paired with bright faculae nearby.
  // Quiet dwarfs skip this entirely; activity scales the group count.
  const act = def.activity ?? 1

  if (act > _SPOT_MIN) {
    const groups = _SPOT_COUNT + Math.floor(rand() * _SPOT_COUNT * act)

    for (let i = 0; i < groups; i++) {
      const x = rand() * SURFACE_W
      const y = SURFACE_H * (_SPOT_LAT_LO + rand() * _SPOT_LAT_HI)

      // Penumbra — broad soft dark wash, then the tight dark umbra.
      blob(
        ctx,
        SURFACE_W,
        SURFACE_H,
        x,
        y,
        SURFACE_H * (_SPOT_PENUMBRA + rand() * _SPOT_RVAR),
        css(shade(base, -_SPOT_PEN_DEPTH), _SPOT_PEN_ALPHA),
        css(base, 0)
      )
      blob(
        ctx,
        SURFACE_W,
        SURFACE_H,
        x,
        y,
        SURFACE_H * (_SPOT_UMBRA + rand() * _SPOT_RVAR * 0.5),
        css(shade(base, -_SPOT_DEPTH), _SPOT_ALPHA),
        css(base, 0)
      )

      // Facula — the bright hot rim that trails a real spot group.
      blob(
        ctx,
        SURFACE_W,
        SURFACE_H,
        x + SURFACE_H * _SPOT_PENUMBRA * (rand() - 0.25),
        y + SURFACE_H * _SPOT_PENUMBRA * (rand() - 0.5),
        SURFACE_H * (_SPOT_PENUMBRA * 0.8),
        css(shade(base, _SPOT_FAC_DEPTH), _SPOT_FAC_ALPHA),
        css(base, 0)
      )
    }
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}
