/**
 * @file coverage/starfield/engine/starfield-catalog-tails.test.js
 * @description Coverage tails for the catalog scale/placement helpers —
 * the `sfChartDist(0)` and `sfGalacticVec` zero-division arms no real
 * body can reach (every catalog def sits at d > 0), plus a regression
 * pin that authored Milky-Way bodies now land at their TRUE compressed
 * radii (the removed legibility band had floored the whole neighborhood
 * onto a single shell).
 */
import { describe, test, expect } from '@jest/globals'

import { shrinkSolar, SF_CATALOG } from '../../../../engine/catalog.js'
import { sfChartDist, sfGalacticPos } from '../../../../engine/scale.js'
import { SF_SCALE } from '@core/tokens/starfield/params.js'
import { SF_TEXTURES } from '@core/tokens/starfield/textures.js'

describe('catalog honest-placement tails', () => {
  test('sfChartDist/sfGalacticPos return the origin for a zero-distance body', () => {
    // The `ly <= 0` guard + `k = 0` division arm — no catalog def sits at
    // 0 ly, so the tail drives both through the real call chain.
    expect(sfChartDist(0)).toBe(0)
    // The z component can surface as −0 through the tilt rotation — the
    // zero-magnitude contract is what matters.
    for (const c of sfGalacticPos(200, 30, 0, SF_SCALE.MW_TILT)) expect(c).toBeCloseTo(0, 12)
  })

  test('nearby stars sit at their true galactic-tier radii, not a shared shell', () => {
    // Alpha Centauri A (4.37 ly → ~1 092 units) keeps its honest radius
    // as the triple-system anchor; Proxima no longer carries its own
    // `pos` — it orbits the pair (`parent` + `orbit`) and Deneb stays
    // the far-ly honest landmark.
    const alpha = SF_CATALOG.find((b) => b.id === 'alpha-centauri')

    const proxima = SF_CATALOG.find((b) => b.id === 'proxima-centauri')

    const deneb = SF_CATALOG.find((b) => b.id === 'deneb')

    expect(Math.hypot(...alpha.pos)).toBeCloseTo(4.37 / SF_SCALE.GALACTIC_LY, 4)
    expect(proxima.parent).toBe('alpha-centauri')
    expect(Math.hypot(...deneb.pos)).toBeCloseTo(2615 / SF_SCALE.GALACTIC_LY, 4)
    expect(Math.hypot(...alpha.pos)).toBeLessThan(Math.hypot(...deneb.pos))
  })

  test('Alpha Centauri is a real orbiting triple: B + Proxima parented, ordered, eccentric', () => {
    const alphaB = SF_CATALOG.find((b) => b.id === 'alpha-centauri-b')

    const proxima = SF_CATALOG.find((b) => b.id === 'proxima-centauri')

    // Both companions orbit the A anchor — a true hierarchy, not two
    // co-located glyphs.
    expect(alphaB.parent).toBe('alpha-centauri')
    expect(proxima.parent).toBe('alpha-centauri')

    // Proxima rides far outside the tight AB pair (real ratio is
    // ~550:1; the chart exaggerates but keeps the ordering honest).
    expect(proxima.orbit).toBeGreaterThan(alphaB.orbit)

    // Real orbital eccentricities — the AB pair's 0.52 swing and
    // Proxima's wider ~0.5 path, not perfect circles.
    expect(alphaB.ecc).toBeGreaterThan(0.4)
    expect(proxima.ecc).toBeGreaterThan(0.4)
  })

  test('Proxima b, c and d orbit the red dwarf as real planets', () => {
    const planets = ['proxima-b', 'proxima-c', 'proxima-d'].map((id) =>
      SF_CATALOG.find((b) => b.id === id)
    )

    for (const p of planets) {
      expect(p).toBeDefined()
      expect(p.parent).toBe('proxima-centauri')
      expect(p.orbit).toBeGreaterThan(0)
      expect(p.speed).toBeGreaterThan(0)
    }

    // Semi-major-axis ordering matches reality: d < b < c.
    const [b, c, d] = planets

    expect(d.orbit).toBeLessThan(b.orbit)
    expect(b.orbit).toBeLessThan(c.orbit)
  })

  test('Kepler-452 wears the real solar photosphere map as a G2V Sun twin', () => {
    // The host resolved as a bare fresnel glow — the seeded-granulation
    // fallback washed flat under the corona at fly-to range. Pinning
    // the honest stand-in (same spectral class) keeps the disc a
    // textured star, and the Earth-cousin planet still orbits it.
    const kepler = SF_CATALOG.find((b) => b.id === 'kepler-452')

    const planet = SF_CATALOG.find((b) => b.id === 'kepler-452-b')

    expect(kepler.texture).toBe(SF_TEXTURES.SUN)
    expect(planet.parent).toBe('kepler-452')
  })

  test('shrinkSolar scales radius/orbit/belt/satellites and keeps absent fields absent', () => {
    const k = SF_SCALE.SOLAR_SCALE

    const full = shrinkSolar({
      id: 'solar-full',
      radius: 10,
      orbit: 40,
      belt: { inner: 20, outer: 30 },
      satellites: [{ radius: 2, orbit: 6, speed: 1 }],
    })

    expect(full.radius).toBeCloseTo(10 * k, 6)
    expect(full.orbit).toBeCloseTo(40 * k, 6)
    expect(full.belt.inner).toBeCloseTo(20 * k, 6)
    expect(full.belt.outer).toBeCloseTo(30 * k, 6)
    expect(full.satellites[0].radius).toBeCloseTo(2 * k, 6)
    expect(full.satellites[0].orbit).toBeCloseTo(6 * k, 6)

    // Orbit-less/belt-less/satellite-less def — the `!= null`/ternary/
    // optional-chain false arms pass the fields through untouched.
    const bare = shrinkSolar({ id: 'solar-bare', radius: 5 })

    expect(bare.orbit).toBeUndefined()
    expect(bare.belt).toBeUndefined()
    expect(bare.satellites).toBeUndefined()
  })
})
