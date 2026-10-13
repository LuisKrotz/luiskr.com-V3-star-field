/**
 * @file engine/bodies/procedural/cluster.ts
 * @description Seeded globular-cluster starfield texture — the no-photo
 * fallback for `SF_KINDS.CLUSTER` bodies (47 Tucanae, M13) which must
 * never render as nebula gas: a globular cluster is a gravitationally
 * bound ball of ~10⁵ old stars, so the texture paints a King-profile
 * point swarm — a dense unresolved core decaying into a sparse halo of
 * resolved members — instead of wispy emission lobes.
 *
 * Star placement is rejection-sampled from a projective King-like
 * surface-density profile
 *
 *   Σ(r) ∝ ( 1/√(1 + (r/r_c)²) − 1/√(1 + (r_t/r_c)²) )²
 *
 * which is the standard zero-order fit for a relaxed globular: the
 * squared term produces the characteristic flat core (Σ ≈ const for
 * r ≪ r_c) breaking into a steep halo that truncates at the tidal
 * radius r_t — photographed clusters show exactly this core+halo
 * silhouette. Brightness per star draws from a warm evolved-population
 * palette (most light in K/M giants) with a seeded blue-straggler
 * minority, and stellar magnitudes scatter as a shallow power law so a
 * handful of bright members stand out over the swarm — matching the
 * luminosity function of a real old population.
 *
 * Deterministic via `${id}:cluster` — every cluster keeps its own
 * speckle pattern on every boot. Returns undefined without 2d canvas.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../../rand.js'
import type { SFBodyDef } from '../../types.js'
import { blob, css, rgb, shade, texCanvas, GAS_PX } from './shared.js'
import type { Rgb, ThreeModule } from './shared.js'

/**
 * Resolved-star count inside the King profile — dense enough that the
 * core reads as blended light, sparse enough that edge members stay
 * individually resolvable. Canvas px budget only; the real clusters
 * carry ~10⁵ members.
 */
const _STAR_COUNT = 420

/** Core radius as a fraction of the half-canvas (r_c ≈ 0.14 r_t). */
const _CORE_FRAC = 0.16

/**
 * Rejection-sampled radius for one cluster star — draws u∈[0,1) as a
 * candidate along the radial axis and keeps it with probability
 * Σ(r)/Σ(0), concentrating draws inside the flat core.
 * @param rand Seeded RNG.
 * @returns Radius in half-canvas units (0 center → 1 edge).
 */
function clusterRadius(rand: () => number): number {
  for (;;) {
    const r = rand()

    // Σ(r)/Σ(0) for the squared King term with r_t/r_c = 1/_CORE_FRAC.
    const c = _CORE_FRAC
    const sigma = (1 / Math.sqrt(1 + (r / c) * (r / c)) - 1 / Math.sqrt(1 + (1 / c) * (1 / c))) ** 2

    if (rand() < sigma) return r
  }
}

/**
 * Paints the seeded globular-cluster texture — unresolved core glow +
 * King-sampled star speckles, used by `makeNebulaSprite` when a cluster
 * catalog entry carries no photo map.
 * @param THREE The three.js module.
 * @param def Cluster def (`id` seeds the swarm, `color` tints the core).
 * @returns A CanvasTexture for the sprite map, or undefined.
 */
export function clusterFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const c = texCanvas(GAS_PX, GAS_PX)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(def.color)
  const rand = lcg(seedFrom(`${def.id}:cluster`))
  const mid = GAS_PX / 2

  // Unresolved starlight — the core's blended luminosity floor, a wide
  // soft blob dimmer and warmer than the resolved swarm on top.
  blob(ctx, GAS_PX, GAS_PX, mid, mid, mid * 0.55, css(shade(base, 0.35), 0.5), css(base, 0))

  // Old-population palette — K/M giants dominate the light, a seeded
  // few percent of blue stragglers sparkle against the warm swarm.
  const warms: Rgb[] = [
    rgb(SF_COLORS.STAR_WHITE),
    rgb(SF_COLORS.STAR_GOLD),
    rgb(SF_COLORS.STAR_ORANGE),
    rgb(SF_COLORS.STAR_RED),
  ]
  const blue = rgb(SF_COLORS.STAR_BLUE)

  for (let i = 0; i < _STAR_COUNT; i++) {
    const r = clusterRadius(rand) * mid * 0.98
    const a = rand() * Math.PI * 2
    const x = mid + Math.cos(a) * r
    const y = mid + Math.sin(a) * r

    // Magnitude scatter — a shallow power law throws a few bright
    // giants over a swarm of faint members (real luminosity function).
    const mag = Math.pow(rand(), 3)
    const size = 0.4 + mag * 2.2
    const alpha = 0.25 + mag * 0.75
    const col = rand() < 0.06 ? blue : warms[Math.floor(rand() * warms.length)]

    blob(ctx, GAS_PX, GAS_PX, x, y, size, css(col, alpha), css(col, 0))
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}
