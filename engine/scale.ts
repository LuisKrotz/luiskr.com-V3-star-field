/**
 * @file engine/scale.ts
 * @description Multi-tier astronomical scale model for the star-field
 * chart. Twenty orders of magnitude separate Neptune's orbit (~0.0005 ly)
 * from the observable-universe boundary (~46 Gly), so no single linear
 * scale can show the whole cosmos in one navigable scene. Instead the
 * chart compresses distance in three documented tiers — every direction
 * stays astronomically true, only radii compress:
 *
 *   Galactic tier    1 unit = 100 ly        (d ≤ 1 Mly)
 *   Local-Group tier 1 unit = 800 ly        (1 Mly < d ≤ 10 Mly)
 *   Cosmic tier      1 unit = 20 000 ly     (d > 10 Mly)
 *
 * Real anchor distances: the Milky Way disc is ~52 000 ly in radius →
 * 520 units; the Sun sits 26 700 ly out → 267 units; the Magellanic
 * Clouds (~160–200 kly) → ~1 600–2 000 units; Andromeda (2.537 Mly) →
 * ~11 900 units; superclusters clamp onto the ~46 000-unit boundary.
 *
 * `sfGalacticPos` converts real galactic coordinates (l, b, distance) to
 * chart positions, and `sfGalacticVec` does the same for Cartesian
 * galactic xyz — both share the axis map + disc tilt the deep-field
 * cloud uses, so authored bodies and the 139k real catalogue land in
 * one consistent coordinate frame.
 */
import { SF_SCALE } from '@core/tokens/starfield/params.js'

/**
 * Piecewise distance → chart-units compression shared by the authored
 * catalog, the deep-field point cloud and the registry fly-to math.
 * Continuous at each break so close objects keep honest ratios: a body
 * twice as far always lands twice as far within a tier, and the tier
 * boundaries join smoothly (1 Mly → 10 000 units from either side).
 * @param ly Heliocentric distance in light-years.
 * @returns Compressed chart radius in scene units.
 */
export function sfChartDist(ly: number): number {
  if (ly <= 0) return 0

  const galacticEdge = SF_SCALE.GALACTIC_BREAK / SF_SCALE.GALACTIC_LY

  if (ly <= SF_SCALE.GALACTIC_BREAK) return ly / SF_SCALE.GALACTIC_LY

  const groupEdge =
    galacticEdge +
    SF_SCALE.LOCAL_GROUP_BREAK / SF_SCALE.LOCAL_GROUP_LY -
    SF_SCALE.GALACTIC_BREAK / SF_SCALE.LOCAL_GROUP_LY

  if (ly <= SF_SCALE.LOCAL_GROUP_BREAK) {
    return galacticEdge + (ly - SF_SCALE.GALACTIC_BREAK) / SF_SCALE.LOCAL_GROUP_LY
  }

  const cosmic = groupEdge + (ly - SF_SCALE.LOCAL_GROUP_BREAK) / SF_SCALE.COSMIC_LY

  return Math.min(cosmic, SF_SCALE.COSMIC_CLAMP)
}

/**
 * Galactic-coordinate → chart-position conversion. Real galactic
 * coordinates are heliocentric: `l` longitude measured from the galactic
 * centre direction, `b` latitude above the plane, `d` distance in
 * light-years. The standard galactic frame (x toward l=0°, y toward
 * l=90°, z toward the north galactic pole) is right-handed; the chart
 * maps it to (-x, z, y) so the galactic centre lands at −X (matching the
 * Milky Way disc's offset centre) while staying right-handed.
 *
 * The same rotation.x the deep-field cloud applies (`-π/2 + tilt`) then
 * leans the whole galactic frame onto the rendered disc tilt, so every
 * authored body shares the plane the particle spiral draws.
 * @param lDeg Galactic longitude in degrees.
 * @param bDeg Galactic latitude in degrees.
 * @param distLy Heliocentric distance in light-years.
 * @param tilt Milky Way disc tilt in radians (the catalog `tilt` field).
 * @returns `[x, y, z]` world position in chart units.
 */
export function sfGalacticPos(
  lDeg: number,
  bDeg: number,
  distLy: number,
  tilt: number
): [number, number, number] {
  const l = (lDeg * Math.PI) / 180

  const b = (bDeg * Math.PI) / 180

  const cosB = Math.cos(b)

  // Spherical galactic direction → galactic Cartesian components, then
  // through the shared Cartesian path below.
  return sfGalacticVec(
    cosB * Math.cos(l) * distLy,
    cosB * Math.sin(l) * distLy,
    Math.sin(b) * distLy,
    tilt
  )
}

/**
 * Cartesian galactic → chart-position conversion — the shared back end
 * of `sfGalacticPos` used directly by the deep-field cloud and registry
 * fly-to, whose records already carry heliocentric galactic xyz. The
 * standard galactic frame (x toward l=0°, y toward l=90°, z toward the
 * north galactic pole) maps to (−x, z, y): chart X = −x_gal puts the
 * galactic centre at −X where the Milky Way disc sits, Y = z_gal raises
 * the north galactic pole, Z = y_gal keeps the frame right-handed. The
 * same `rotation.x = −π/2 + tilt` the cloud applies then leans the
 * whole galactic frame onto the rendered disc tilt.
 * @param xGal Heliocentric x_gal in light-years (toward l=0°).
 * @param yGal Heliocentric y_gal in light-years (toward l=90°).
 * @param zGal Heliocentric z_gal in light-years (toward NGP).
 * @param tilt Milky Way disc tilt in radians (the catalog `tilt` field).
 * @returns `[x, y, z]` world position in chart units.
 */
export function sfGalacticVec(
  xGal: number,
  yGal: number,
  zGal: number,
  tilt: number
): [number, number, number] {
  const dLy = Math.sqrt(xGal * xGal + yGal * yGal + zGal * zGal)

  const k = dLy > 0 ? sfChartDist(dLy) / dLy : 0

  const px = -xGal * k

  const py = zGal * k

  const pz = yGal * k

  const a = -Math.PI / 2 + tilt

  const cos = Math.cos(a)

  const sin = Math.sin(a)

  const y1 = py * cos - pz * sin

  const z1 = py * sin + pz * cos

  return [px, y1, z1]
}
