/**
 * @file coverage/starfield/engine/starfield-catalog-tails.test.js
 * @description Coverage tails for the catalog placement helpers —
 * `nbr`'s two arms no catalog def can reach: the beyond-band passthrough
 * (`honest ≥ INNER+BAND` needs a body past ~30k ly, but every `nbr` def
 * is a solar-neighborhood star) and the zero-vector guard (`!n` needs a
 * body at exactly 0 ly). Calls `nbr` directly; the zero case also drives
 * `sfChartDist`'s `ly <= 0` guard and `sfGalacticVec`'s zero-division
 * arm in scale.ts through the same call chain.
 */
import { describe, test, expect } from '@jest/globals'

import { nbr, shrinkSolar } from '../../../../engine/catalog.js'
import { SF_SCALE } from '@core/tokens/starfield/params.js'

describe('catalog neighborhood-band placement tails', () => {
  test('nbr passes the raw galactic position through beyond the band', () => {
    // 100 000 ly → honest 1 000 units ≥ INNER+BAND (600) — distant bodies
    // keep their truthful compressed radius instead of the band clamp.
    const pos = nbr(200, 30, 100000)

    expect(Math.hypot(...pos)).toBeCloseTo(100000 / SF_SCALE.GALACTIC_LY, 6)
  })

  test('nbr returns the origin for a zero-distance body', () => {
    // honest=0 < bandEdge → gpos yields a zero vector → `!n` guard.
    // Transitively covers sfChartDist(0) and sfGalacticVec's `k = 0` arm.
    expect(nbr(0, 0, 0)).toEqual([0, 0, 0])
  })

  test('nbr compresses inside-band bodies onto the legibility ring', () => {
    // 100 ly → honest 1 unit < 300 → direction preserved, radius rides
    // the neighborhood band (INNER + min(honest, BAND)).
    const pos = nbr(200, 30, 100)

    expect(Math.hypot(...pos)).toBeCloseTo(SF_SCALE.NEIGHBORHOOD_INNER + 1, 6)
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
