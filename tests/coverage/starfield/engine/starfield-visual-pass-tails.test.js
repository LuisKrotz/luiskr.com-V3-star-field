/**
 * @file coverage/starfield/engine/starfield-visual-pass-tails.test.js
 * @description Coverage tails for the visual-quality pass added to the
 * star-field: optional-renderer resize arms, approach prefetch, spiral
 * bubble resampling, and the masked-texture null-context fallback.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { createStarState } from '../../../../engine/state.js'
import { handleStarResize, tickStar } from '../../../../engine/frame.js'
import { maskPhotoTexture } from '../../../../engine/bodies/mask.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { SF_APPROACH } from '@core/tokens/starfield/params.js'
import * as THREE from 'three'

const makeCanvas = () => document.createElement(HTML_TAGS.CANVAS)

const makeState = (overrides = {}) => {
  const s = createStarState(makeCanvas())

  return Object.assign(s, overrides)
}

const fakeCamera = () => ({
  position: { x: 0, y: 0, z: 0, set: jest.fn() },
  aspect: 1,
  updateProjectionMatrix: jest.fn(),
})

beforeEach(() => {
  document.documentElement.classList.remove('reduced-motion')
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('handleStarResize', () => {
  test('tolerates a renderer without setPixelRatio or setSize', () => {
    const s = makeState({
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
    })

    // Both optional methods missing → the ?. calls return undefined without
    // throwing; this was the uncovered branch in the visual-quality pass.
    expect(() => handleStarResize(s)).not.toThrow()

    // Partial method set also safe.
    s.renderer = { setPixelRatio: jest.fn() }
    expect(() => handleStarResize(s)).not.toThrow()
  })
})

describe('checkApproach', () => {
  test('prefetches dossier for a body within the approach threshold', () => {
    const onApproach = jest.fn()
    const s = makeState({
      camera: fakeCamera(),
      onApproach,
    })

    // Place the anchor well inside the approach radius so the inner body
    // of checkApproach executes deterministically.
    s.nodes.set('near', {
      def: { radius: 1 },
      pivot: {},
      spinner: {},
      mesh: {},
      satPivots: [],
    })
    s.anchors.set('near', {
      getWorldPosition: () => ({ x: 1, y: 0, z: 0 }),
    })

    // Sanity: distance is 1, threshold is PAD + 1*SCALE.
    expect(1).toBeLessThan(SF_APPROACH.PAD + SF_APPROACH.SCALE)

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    tickStar(s, 0)

    expect(onApproach).toHaveBeenCalledWith('near')
    expect(s.approached.has('near')).toBe(true)

    raf.mockRestore()
  })
})

describe('spiral bubble resampling', () => {
  test('resamples points that fall inside the heliocentric exclusion bubble', () => {
    // A huge bubble centered on the local origin catches every first
    // sample and forces the while-loop resample branch to run.
    const def = {
      id: 'bubble-test',
      kind: SF_KINDS.GALAXY,
      radius: 100,
      color: 0xffffff,
      pos: [0, 0, 0],
      tilt: 0,
      spiralDisc: {
        count: 8,
        arms: 2,
        bubble: 1000,
      },
    }

    const { points } = makeSpiralGalaxy(THREE, def, undefined, undefined, false)

    expect(points).toBeTruthy()
    expect(points.geometry).toBeTruthy()
  })
})

describe('maskPhotoTexture', () => {
  test('returns undefined when canvas 2d context is unavailable', () => {
    const tex = {
      image: { naturalWidth: 64, naturalHeight: 64 },
      colorSpace: '',
    }

    const originalGetContext = window.HTMLCanvasElement.prototype.getContext

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => {
      if (type === '2d') return null

      return originalGetContext.call(this, type)
    })

    expect(maskPhotoTexture(THREE, tex)).toBeUndefined()
  })
})
