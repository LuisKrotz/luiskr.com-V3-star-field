/**
 * @file engine/catalog/geo.ts
 * @description Shared chart-geometry helpers for the catalog — galactic-
 * coordinate placement (`gpos`), the Milky Way disc center/radius,
 * Andromeda's real-coordinate position, and `shrinkSolar`, the
 * solar-tier scale transform applied to every AU-diagram def.
 * Split out of catalog.ts; see that file for the layout contract.
 */

import { SF_SCALE, SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { sfGalacticPos } from '../scale.js'
import type { SFBodyDef } from '../types.js'

/**
 * Galactic-coordinate placement — every deep-sky body lands on its real
 * galactic (l, b) direction at the multi-tier compressed distance, in the
 * same tilted frame the Milky Way particle disc and the deep-field cloud
 * render. Directions stay astronomically true; only radii compress.
 * @param l Galactic longitude in degrees.
 * @param b Galactic latitude in degrees.
 * @param dLy Heliocentric distance in light-years.
 * @returns `[x, y, z]` chart position in scene units.
 */
export const gpos = (l: number, b: number, dLy: number): [number, number, number] =>
  sfGalacticPos(l, b, dLy, SF_SCALE.MW_TILT)

/**
 * Milky Way disc center — the Sun sits at the scene origin and its true
 * 26 700-ly galactocentric distance lands the disc center 267 units
 * down −X (the `sfGalacticVec` axis map puts l=0 at −X), so the solar
 * system renders embedded inside the disc at its real half-radius ring
 * instead of floating beside a face-on photo.
 */
export const MW_CENTER: [number, number, number] = [
  -SF_STAR_CLOUD.SUN_GC_LY / SF_SCALE.GALACTIC_LY,
  0,
  0,
]

/** Milky Way disc radius in chart units — 52 000 ly at the galactic tier. */
export const MW_RADIUS = SF_SCALE.MW_DISC_LY / SF_SCALE.GALACTIC_LY

/**
 * Andromeda's real galactic coordinates — shared by the M31 def and the
 * Local Group shell, whose boundary centers on the MW↔M31 midpoint.
 */
const M31_L = 121.17
const M31_B = -21.57
const M31_LY = 2537000

/** Andromeda's compressed chart position — ~11.9k units toward l=121°. */
export const M31_POS = gpos(M31_L, M31_B, M31_LY)

/**
 * Solar-tier shrink — every AU-scale body authored below is diagram-size
 * (a 12-unit Sun would mass 1 200 ly at the galactic tier — bigger than
 * honestly-scaled dwarf spheroidals). Multiplying the whole tier by
 * SF_SCALE.SOLAR_SCALE lands the Sun's drawn disc at 0.024 units — under
 * Proxima's true 0.042-unit distance, so no star renders inside the
 * photosphere — and the whole system inside ~0.23 units, honest ordering
 * against the stellar neighbourhood at the cost of planet specks that
 * only the fly-to/zoom tier reveals.
 * `radius`, `orbit`, `belt` bounds and `satellites` all shrink together
 * so internal proportions stay authored. Exported so coverage tails can
 * pin every arm — no current solar def carries satellites, but the arm
 * keeps a future moon-bearing def honest.
 * @param def Solar-tier body at authored diagram scale.
 * @returns Copy with every spatial field scaled by SOLAR_SCALE.
 */
export const shrinkSolar = (d: SFBodyDef): SFBodyDef => ({
  ...d,
  radius: d.radius * SF_SCALE.SOLAR_SCALE,
  orbit: d.orbit != null ? d.orbit * SF_SCALE.SOLAR_SCALE : d.orbit,
  belt: d.belt
    ? {
        ...d.belt,
        inner: d.belt.inner * SF_SCALE.SOLAR_SCALE,
        outer: d.belt.outer * SF_SCALE.SOLAR_SCALE,
      }
    : d.belt,
  satellites: d.satellites?.map((s) => ({
    ...s,
    radius: s.radius * SF_SCALE.SOLAR_SCALE,
    orbit: s.orbit * SF_SCALE.SOLAR_SCALE,
  })),
})
