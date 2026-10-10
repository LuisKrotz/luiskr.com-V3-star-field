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

import { nbr } from '../../../../engine/catalog.js'
import { SF_SCALE } from '@core/tokens/starfield/params.js'

describe('catalog neighborhood-band placement tails', () => {
  test('nbr passes the raw galactic position through beyond the band', () => {
    // 40 000 ly → honest 400 units ≥ INNER+BAND (300) — distant bodies
    // keep their truthful compressed radius instead of the band clamp.
    const pos = nbr(200, 30, 40000)

    expect(Math.hypot(...pos)).toBeCloseTo(40000 / SF_SCALE.GALACTIC_LY, 6)
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
})
