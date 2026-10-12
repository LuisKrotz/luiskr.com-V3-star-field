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
    // Proxima (4.246 ly → 0.042 units) and Deneb (2 615 ly → 26.15
    // units) must keep their honest radii — distinct, ordered, and far
    // inside the Sun's 267-unit galactocentric ring.
    const proxima = SF_CATALOG.find((b) => b.id === 'proxima-centauri')

    const deneb = SF_CATALOG.find((b) => b.id === 'deneb')

    expect(Math.hypot(...proxima.pos)).toBeCloseTo(4.246 / SF_SCALE.GALACTIC_LY, 4)
    expect(Math.hypot(...deneb.pos)).toBeCloseTo(2615 / SF_SCALE.GALACTIC_LY, 4)
    expect(Math.hypot(...proxima.pos)).toBeLessThan(Math.hypot(...deneb.pos))
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
