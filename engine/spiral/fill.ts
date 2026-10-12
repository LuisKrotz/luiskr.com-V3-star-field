/**
 * @file engine/spiral/fill.ts
 * @description Deterministic point-cloud fills for galaxies — the math
 * the WASM worker mirrors byte-for-byte (see
 * `core/public/scripts/workers/wasm-worker.js` SF_FILL_* handlers).
 * Every point draws from its own Fibonacci-hashed LCG keyed by absolute
 * index, so a fill partitions across worker chunks identically to this
 * local path — keep both implementations in lockstep or parity breaks.
 */
import { SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { lcg } from '../rand.js'

/**
 * Fills the position + color buffers for one spiral galaxy: `BULGE`
 * fraction of points cluster in the core (tight gaussian), the rest
 * follow `ARMS` logarithmic arms with angular jitter and a thin vertical
 * gaussian so the disc reads as a real spiral at any tilt. An optional
 * `halo` fraction peels off the tail of the buffer into a spherical
 * stellar-halo distribution (globular-cluster haze standing in for the
 * oldest populations), and `thick` multiplies disc thickness for bodies
 * like the Milky Way whose volume must read as a 3-D object from inside.
 * @param pos Float32 xyz buffer — indexes [i0·3, i1·3) are written.
 * @param col Float32 rgb buffer (same range).
 * @param radius Disc radius in scene units.
 * @param seed Body seed — each point draws from its own LCG keyed by
 *   absolute index (`seed ^ i·SEED_STEP`), so the fill is partitionable
 *   across worker chunks with identical output to this local path.
 * @param count Point count to fill.
 * @param arms Spiral arm count.
 * @param thick Disc-thickness multiplier on `SF_SPIRAL.THIN`.
 * @param halo Fraction (0–1) of points scattered into a spherical halo.
 * @param jitter Arm angular scatter in radians — tight jitters draw
 *   crisp arm lanes (volumetric discs), loose ones a flocculent wash.
 * @param bubble Optional heliocentric exclusion zone — `{ x, y, z, r }`
 *   in the galaxy's local frame; points falling inside are resampled so
 *   no disc star overlaps the solar system.
 * @param i0 First point index of this range (0 for the local fill).
 * @param i1 One past the last point index (count for the local fill).
 */
export function fillSpiral(
  pos: Float32Array,
  col: Float32Array,
  radius: number,
  seed: number,
  count: number,
  arms: number,
  thick = 1,
  halo = 0,
  jitter: number = SF_SPIRAL.ARM_JITTER,
  bubble?: { x: number; y: number; z: number; r: number },
  i0 = 0,
  i1 = count
): void {
  const bulgeCount = Math.floor(count * SF_SPIRAL.BULGE)

  const haloCount = Math.floor(count * halo)

  // Bar axis — the Milky Way is a barred spiral, so its bulge stretches
  // along an in-plane axis instead of staying spherical. The tilt is a
  // golden-fraction hash of the galaxy seed (deterministic per galaxy,
  // zero RNG-stream consumption → worker/local fills stay identical).
  const g = seed * (SF_SPIRAL.GOLDEN - 1)

  const barTilt = (g - Math.floor(g)) * Math.PI * 2

  const barCos = Math.cos(barTilt)

  const barSin = Math.sin(barTilt)

  // Disc-warp phase — perpendicular to the seeded bar axis (real warps
  // sit roughly orthogonal to the bar); derived, not drawn, so the
  // per-point RNG stream is untouched and worker parity is preserved.
  const warpPhase = barTilt + Math.PI / 2

  for (let i = i0; i < i1; i++) {
    // Per-point stream — Fibonacci-hashed seed by absolute index makes
    // the fill chunkable across worker threads with identical output.
    const rand = lcg((seed ^ Math.imul(i + 1, SF_SPIRAL.SEED_STEP)) >>> 0)
    const inHalo = i >= count - haloCount

    const inBulge = i < bulgeCount

    if (inHalo) {
      // Stellar halo — uniform spherical gaussian around the core, far
      // thicker than the disc; dimmed toward the edge ramp so it reads
      // as a faint enveloping haze, not a second disc.
      const rr = Math.abs(rand() + rand() - 1) * radius * SF_SPIRAL.HALO_RADIUS

      const u = rand() * 2 - 1

      const theta = rand() * Math.PI * 2

      const s = Math.sqrt(1 - u * u)

      pos[i * 3] = Math.cos(theta) * s * rr
      pos[i * 3 + 1] = u * rr
      pos[i * 3 + 2] = Math.sin(theta) * s * rr

      const k = 0.5 + 0.5 * (rr / (radius * SF_SPIRAL.HALO_RADIUS))

      // Stellar halos are faint — HALO_DIM keeps the wash under the
      // disc's light so it reads as a ghostly envelope, not a ball.
      col[i * 3] =
        (SF_SPIRAL.CORE_R + (SF_SPIRAL.EDGE_R - SF_SPIRAL.CORE_R) * k) * SF_SPIRAL.HALO_DIM
      col[i * 3 + 1] =
        (SF_SPIRAL.CORE_G + (SF_SPIRAL.EDGE_G - SF_SPIRAL.CORE_G) * k) * SF_SPIRAL.HALO_DIM
      col[i * 3 + 2] =
        (SF_SPIRAL.CORE_B + (SF_SPIRAL.EDGE_B - SF_SPIRAL.CORE_B) * k) * SF_SPIRAL.HALO_DIM
    } else {
      // Radial distance — bulge is tight gaussian; arm points spread
      // sqrt-uniform out to radius×DISC_SPREAD (the overshoot band is
      // where the rim dissolve fades them to zero).
      const r = inBulge
        ? Math.abs(rand() + rand() - 1) * radius * 0.16
        : Math.sqrt(rand()) * radius * SF_SPIRAL.DISC_SPREAD

      // Golden-pitch log spiral — θ = B·ln(r/R0), the spiral whose
      // radius grows by φ per quarter-turn (constant 17.03° pitch). A
      // slow sinusoidal sway keyed by the golden angle per arm keeps
      // the lane meandering like a real flocculent arm instead of a
      // drawn curve.
      const lr = Math.log(Math.max(r, SF_SPIRAL.ARM_LOG_RMIN) / SF_SPIRAL.ARM_LOG_R0)

      const arm = i % arms

      // Per-arm geometry — each lane winds at a slightly different rate
      // (±ARM_PITCH_VAR, phased by the golden angle) and carries its own
      // luminance so the disc reads as four distinct arms, not parallel
      // copies of one curve. The sway amplitude also grows with radius:
      // resonance-locked inner lanes run smooth while the rim wanders.
      const armB =
        SF_SPIRAL.ARM_LOG_B *
        SF_SPIRAL.ARM_PITCH_TIGHT *
        (1 + SF_SPIRAL.ARM_PITCH_VAR * Math.sin(arm * SF_SPIRAL.GOLDEN_ANGLE))

      const armLum = 1 - SF_SPIRAL.ARM_LUM_VAR * Math.abs(Math.sin(arm * SF_SPIRAL.GOLDEN_ANGLE))

      const base =
        lr * armB +
        (arm * Math.PI * 2) / arms +
        Math.sin(r * SF_SPIRAL.ARM_SWAY_FREQ + arm * SF_SPIRAL.GOLDEN_ANGLE) *
          SF_SPIRAL.ARM_SWAY_AMP *
          (SF_SPIRAL.ARM_SWAY_CORE + (1 - SF_SPIRAL.ARM_SWAY_CORE) * Math.min(1, r / radius))

      // Organic scatter — real spiral arms dissolve outward: the jitter
      // band widens from ARM_JITTER_CORE×jitter near the core to
      // ARM_JITTER_RIM×jitter at the rim (flocculent fringe), and a spur
      // fraction of points lands between the main arms as the branching
      // feather lanes real galaxies show. The scatter itself is a
      // three-die triangular sum — a cheap bell curve — so lane density
      // falls off smoothly at the edges instead of cutting hard.
      const rimK = inBulge
        ? 0
        : SF_SPIRAL.ARM_JITTER_CORE +
          (SF_SPIRAL.ARM_JITTER_RIM - SF_SPIRAL.ARM_JITTER_CORE) * (r / radius)

      const spur = !inBulge && rand() < SF_SPIRAL.ARM_SPUR_FRAC

      const jj = jitter * rimK + (spur ? SF_SPIRAL.ARM_SPUR_JITTER : 0)

      // The scatter draw doubles as the lane-distance measure — small
      // |scatter| sits on the arm spine (blue young population), large
      // |scatter| drifts into the gap haze (warm ramp stays).
      const scatter = inBulge ? 0 : rand() + rand() + rand() - 1.5

      const angle = inBulge
        ? rand() * Math.PI * 2
        : base + (spur ? Math.PI / arms : 0) + scatter * jj

      const y = (rand() + rand() - 1) * radius * SF_SPIRAL.THIN * thick * (inBulge ? 3.2 : 1)

      // Flare + warp — vertical spread grows with radius (the real disc
      // thickens outward) and the outer ring bends out of the midplane
      // (integral-sign warp, strongest at the rim where (r/R)² → 1).
      const rn = Math.min(1, r / radius)

      const yy = inBulge
        ? y
        : y * (1 + rn * SF_SPIRAL.DISC_FLARE) +
          SF_SPIRAL.DISC_WARP * radius * rn * rn * Math.sin(angle - warpPhase)

      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = yy
      pos[i * 3 + 2] = Math.sin(angle) * r

      // Galactic bar — bulge points elongate into a prolate spheroid
      // along the seeded bar axis: rotate into the bar frame, stretch
      // the along-bar component by BAR_X, rotate back. Arm points are
      // untouched — real bars only reshape the central region.
      if (inBulge) {
        const u = pos[i * 3] * barCos + pos[i * 3 + 2] * barSin

        const v = -pos[i * 3] * barSin + pos[i * 3 + 2] * barCos

        pos[i * 3] = u * SF_SPIRAL.BAR_X * barCos - v * barSin
        pos[i * 3 + 2] = u * SF_SPIRAL.BAR_X * barSin + v * barCos
      }

      // Warm core → cool edge ramp; bulge stays near-core tint.
      const k = inBulge ? 0.22 : r / radius

      // Star-forming knots — azimuthal lobes drifting with ln r dim the
      // lane between clumps; the positive lobe raised to KNOT_POW leaves
      // only sparse peaks, which get an additive blue-white boost so OB
      // associations and H-II regions read as discrete hot knots.
      const w = Math.sin(angle * SF_SPIRAL.KNOT_LOBES - lr * SF_SPIRAL.KNOT_DRIFT)

      const knot = inBulge ? 1 : 1 - SF_SPIRAL.KNOT_DEPTH + SF_SPIRAL.KNOT_DEPTH * w * w

      const hot = inBulge ? 0 : Math.max(0, w) ** SF_SPIRAL.KNOT_POW

      // Per-point luminance grain — triangular ±LUM_JITTER scatter keeps
      // the lane granular like a resolved stellar population.
      const lum = 1 + (rand() + rand() - 1) * SF_SPIRAL.LUM_JITTER

      // H-II vs OB knot tint — HII_FRAC of hot knots glow emission-line
      // pink (hydrogen alpha) instead of blue-white continuum.
      const hii = !inBulge && rand() < SF_SPIRAL.HII_FRAC

      const hotR = hii ? SF_SPIRAL.HII_R : SF_SPIRAL.KNOT_HOT_R

      const hotG = hii ? SF_SPIRAL.HII_G : SF_SPIRAL.KNOT_HOT_G

      const hotB = hii ? SF_SPIRAL.HII_B : SF_SPIRAL.KNOT_HOT_B

      // Rim dissolve — brightness rolls to zero across the overshoot
      // band, so the disc edge vaporizes rather than cutting a ring.
      const edge = Math.min(
        1,
        Math.max(
          0,
          (radius * SF_SPIRAL.DISC_SPREAD - r) /
            (radius * (SF_SPIRAL.DISC_SPREAD - SF_SPIRAL.EDGE_FADE_START))
        )
      )

      // Lane-distance blue shift — on-spine points (|scatter|→0) blend
      // LANE_MIX toward the blue-white arm tint; gap haze keeps the
      // radial warm→cool ramp unchanged.
      const lane = inBulge ? 0 : 1 - Math.min(1, Math.abs(scatter) * SF_SPIRAL.LANE_SCATTER_INV)

      const laneMix = lane * SF_SPIRAL.LANE_MIX

      const glow = knot * edge * armLum * lum

      const hotEdge = hot * edge * armLum

      const baseR = SF_SPIRAL.CORE_R + (SF_SPIRAL.EDGE_R - SF_SPIRAL.CORE_R) * k

      const baseG = SF_SPIRAL.CORE_G + (SF_SPIRAL.EDGE_G - SF_SPIRAL.CORE_G) * k

      const baseB = SF_SPIRAL.CORE_B + (SF_SPIRAL.EDGE_B - SF_SPIRAL.CORE_B) * k

      col[i * 3] = (baseR + (SF_SPIRAL.LANE_R - baseR) * laneMix) * glow + hotEdge * hotR
      col[i * 3 + 1] = (baseG + (SF_SPIRAL.LANE_G - baseG) * laneMix) * glow + hotEdge * hotG
      col[i * 3 + 2] = (baseB + (SF_SPIRAL.LANE_B - baseB) * laneMix) * glow + hotEdge * hotB
    }

    // Heliocentric exclusion bubble — the point just written (halo,
    // bulge or arm) resamples while it sits inside the Sun's carve-out,
    // so no disc star materializes on top of the solar system.
    if (bubble) {
      const dx0 = pos[i * 3] - bubble.x

      const dy0 = pos[i * 3 + 1] - bubble.y

      const dz0 = pos[i * 3 + 2] - bubble.z

      const inside = dx0 * dx0 + dy0 * dy0 + dz0 * dz0 < bubble.r * bubble.r

      if (inside && rand() < SF_SPIRAL.BUBBLE_KEEP) {
        // Sparse local field — the real Local Bubble is underdense, not
        // hollow: a faint kept fraction fills the carve-out so the
        // solar region doesn't read as a scrubbed hole.
        col[i * 3] *= SF_SPIRAL.BUBBLE_DIM
        col[i * 3 + 1] *= SF_SPIRAL.BUBBLE_DIM
        col[i * 3 + 2] *= SF_SPIRAL.BUBBLE_DIM
      } else if (inside) {
        let tries = 0

        while (tries++ < 8) {
          const dx = pos[i * 3] - bubble.x

          const dy = pos[i * 3 + 1] - bubble.y

          const dz = pos[i * 3 + 2] - bubble.z

          if (dx * dx + dy * dy + dz * dz >= bubble.r * bubble.r) break

          // Resample along the same ring — rotate the point around the
          // disc axis so it keeps its radial band (and thus its arm
          // density neighborhood) instead of jumping to a uniform
          // square that clumped near the core and left a wedge.
          const rr = Math.hypot(pos[i * 3], pos[i * 3 + 2])

          const a = rand() * Math.PI * 2

          pos[i * 3] = Math.cos(a) * rr
          pos[i * 3 + 1] = (rand() + rand() - 1) * radius * SF_SPIRAL.THIN * thick
          pos[i * 3 + 2] = Math.sin(a) * rr
        }
      }
    }
  }
}

/**
 * Fills the buffers for an elliptical dwarf galaxy — no spiral structure,
 * just a smooth spheroid of old stars: a gaussian radial profile (dense
 * core, exponential fall-off) over uniform directions, flattened on Y so
 * the smudge reads as a dE/dSph rather than a ball. The `tint` hex steers
 * the vertex ramp so spheroidals glow warm and irregulars read cooler.
 * @param pos Float32 xyz buffer — indexes [i0·3, i1·3) are written.
 * @param col Float32 rgb buffer (same range).
 * @param radius Body radius in scene units.
 * @param seed Body seed — per-point Fibonacci-hashed LCG (chunkable).
 * @param count Point count to fill.
 * @param tint RGB multiplier tint (from def.color channel components).
 * @param i0 First point index of this range (0 for the local fill).
 * @param i1 One past the last point index (count for the local fill).
 */
export function fillElliptical(
  pos: Float32Array,
  col: Float32Array,
  radius: number,
  seed: number,
  count: number,
  tint: [number, number, number],
  i0 = 0,
  i1 = count
): void {
  for (let i = i0; i < i1; i++) {
    const rand = lcg((seed ^ Math.imul(i + 1, SF_SPIRAL.SEED_STEP)) >>> 0)
    // Gaussian-ish radial profile — sum of three uniforms approximates a
    // normal; the ELLIPSE_FLAT squash on Y flattens the spheroid.
    const r = Math.abs(rand() + rand() + rand() - 1.5) * radius * SF_SPIRAL.ELLIPSE_RADIAL

    const u = rand() * 2 - 1

    const theta = rand() * Math.PI * 2

    const s = Math.sqrt(1 - u * u)

    pos[i * 3] = Math.cos(theta) * s * r
    pos[i * 3 + 1] = u * r * SF_SPIRAL.ELLIPSE_FLAT
    pos[i * 3 + 2] = Math.sin(theta) * s * r

    // Bright core → dim rim; tint applies the dwarf's population color.
    const k = Math.min(1, r / radius)

    // Rim roll-off — the radial fill cuts off at ~1.5×ELLIPSE_RADIAL of
    // the radius; fading brightness to zero across the outer band keeps
    // the cutoff invisible so the dwarf melts into the sky.
    const edgeNorm = r / (radius * SF_SPIRAL.ELLIPSE_RADIAL * 1.5)

    const edgeFade =
      1 -
      Math.min(1, Math.max(0, (edgeNorm - SF_SPIRAL.ELLIPSE_EDGE) / (1 - SF_SPIRAL.ELLIPSE_EDGE)))

    const bright = (SF_SPIRAL.ELLIPSE_CORE - k * SF_SPIRAL.ELLIPSE_FADE) * edgeFade

    col[i * 3] = tint[0] * bright
    col[i * 3 + 1] = tint[1] * bright
    col[i * 3 + 2] = tint[2] * bright
  }
}

/**
 * Fills the dust-lane buffers — the Great Rift. Lanes hug the arm gaps
 * (half an arm period off the star arms) on the same golden-pitch log
 * spiral + sway the star fill uses, so dust traces the actual gaps
 * rather than a parallel-but-different curve. Per-point Fibonacci-hashed
 * seeds keep the fill chunkable across the worker pool.
 * @param pos Float32 xyz buffer — indexes [i0·3, i1·3) are written.
 * @param col Float32 rgb buffer (same range).
 * @param seed Body seed.
 * @param count Dust point count.
 * @param radius Disc radius in scene units.
 * @param arms Spiral arm count.
 * @param i0 First point index of this range.
 * @param i1 One past the last point index.
 */
export function fillDust(
  pos: Float32Array,
  col: Float32Array,
  seed: number,
  count: number,
  radius: number,
  arms: number,
  i0 = 0,
  i1 = count
): void {
  for (let i = i0; i < i1; i++) {
    const rand = lcg((seed ^ Math.imul(i + 1, SF_SPIRAL.SEED_STEP)) >>> 0)

    const r =
      (SF_SPIRAL.DUST_R_MIN + (SF_SPIRAL.DUST_R_MAX - SF_SPIRAL.DUST_R_MIN) * Math.sqrt(rand())) *
      radius

    const lr = Math.log(Math.max(r, SF_SPIRAL.ARM_LOG_RMIN) / SF_SPIRAL.ARM_LOG_R0)

    const arm = i % arms

    // Dust sits in the inter-arm gap (arm+0.5) and tracks the same
    // perturbed pitch the star lanes use — evaluated at the midpoint so
    // the rift follows the average of the flanking arms' winding — plus
    // the same radius-grown sway so the rift meanders with them.
    const gapB =
      SF_SPIRAL.ARM_LOG_B *
      SF_SPIRAL.ARM_PITCH_TIGHT *
      (1 + SF_SPIRAL.ARM_PITCH_VAR * Math.sin((arm + 0.5) * SF_SPIRAL.GOLDEN_ANGLE))

    const base =
      lr * gapB +
      ((arm + 0.5) * Math.PI * 2) / arms +
      Math.sin(r * SF_SPIRAL.ARM_SWAY_FREQ + (arm + 0.5) * SF_SPIRAL.GOLDEN_ANGLE) *
        SF_SPIRAL.ARM_SWAY_AMP *
        (SF_SPIRAL.ARM_SWAY_CORE + (1 - SF_SPIRAL.ARM_SWAY_CORE) * Math.min(1, r / radius))

    const angle = base + (rand() + rand() + rand() - 1.5) * SF_SPIRAL.DUST_JITTER

    const y = (rand() + rand() - 1) * radius * SF_SPIRAL.THIN * SF_SPIRAL.VOLUMETRIC_THICK * 0.4

    pos[i * 3] = Math.cos(angle) * r
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = Math.sin(angle) * r

    // Near-black with slight warm cast — interstellar dust reddens.
    col[i * 3] = SF_SPIRAL.DUST_R
    col[i * 3 + 1] = SF_SPIRAL.DUST_G
    col[i * 3 + 2] = SF_SPIRAL.DUST_B
  }
}
