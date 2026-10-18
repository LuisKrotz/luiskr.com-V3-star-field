/**
 * @file coverage/starfield/engine/starfield-visual-pass-tails.test.js
 * @description Coverage tails for the visual-quality pass added to the
 * star-field: optional-renderer resize arms, approach prefetch edges,
 * structure-shell and volumetric-cloud frame fades, spiral bubble
 * resampling, and the masked-texture null-context fallbacks.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { createStarState } from '../../../../engine/state.js'
import { handleStarResize, tickStar, armFrame } from '../../../../engine/frame.js'
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

const ctxProto = () => window.HTMLCanvasElement.prototype

/** Fake 2d context covering the mask calls. */
const fake2d = () => ({
  drawImage: jest.fn(),
  createRadialGradient: () => ({ addColorStop: jest.fn() }),
  fillStyle: '',
  globalCompositeOperation: '',
  fillRect: jest.fn(),
})

/** Minimal loaded-texture stand-in. */
const fakePhoto = (w = 400, h = 200) => ({
  image: { naturalWidth: w, naturalHeight: h },
  colorSpace: '',
})

const makeNode = (def, mesh = {}, extra = {}) => ({
  def,
  pivot: { rotation: { y: 0 } },
  spinner: { rotation: { y: 0 } },
  mesh,
  satPivots: [],
  ...extra,
})

beforeEach(() => {
  document.documentElement.classList.remove('reduced-motion')
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('handleStarResize', () => {
  test('tolerates a renderer without setPixelRatio or setSize', () => {
    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    const s = makeState({
      canvas,
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
    })

    // Both optional methods missing → the ?. calls return undefined without
    // throwing; this was the uncovered branch in the visual-quality pass.
    expect(() => handleStarResize(s)).not.toThrow()

    // Partial method set also safe.
    s.renderer = { setPixelRatio: jest.fn() }
    expect(() => handleStarResize(s)).not.toThrow()

    canvas.remove()
  })
})

describe('checkApproach', () => {
  test('prefetches only bodies within the approach threshold', () => {
    armFrame(THREE.Vector3)

    const onApproach = jest.fn()
    const s = makeState({
      camera: fakeCamera(),
      onApproach,
    })

    // Near body: inside threshold → onApproach fires.
    s.nodes.set('near', makeNode({ radius: 1 }))
    s.anchors.set('near', {
      getWorldPosition: () => ({ x: 1, y: 0, z: 0 }),
    })

    // Far body: outside threshold → the if condition's false branch.
    s.nodes.set('far', makeNode({ radius: 1 }))
    s.anchors.set('far', {
      getWorldPosition: () => ({ x: 1e9, y: 0, z: 0 }),
    })

    // Sanity: near is inside, far is outside.
    expect(1).toBeLessThan(SF_APPROACH.PAD + SF_APPROACH.SCALE)
    expect(1e9).toBeGreaterThan(SF_APPROACH.PAD + SF_APPROACH.SCALE)

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    tickStar(s, 0)

    expect(onApproach).toHaveBeenCalledWith('near')
    expect(s.approached.has('near')).toBe(true)
    expect(s.approached.has('far')).toBe(false)

    raf.mockRestore()
  })
})

describe('structure shell + volumetric cloud fades', () => {
  test('updateStructures + updateGalaxyClouds cover every node arm', () => {
    armFrame(THREE.Vector3)

    const s = makeState({
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
      scene: {},
      controls: { update: jest.fn() },
    })

    // Plain body → `kind !== 'structure'` + `!volumetric` continue arms.
    s.nodes.set('planet', makeNode({ radius: 1 }))

    // Full structure → `structure.radius` arm, fade + speckleMat true arms.
    s.nodes.set(
      'shell',
      makeNode(
        { kind: 'structure', radius: 10, structure: { radius: 20 } },
        {
          userData: {
            fade: { value: 0 },
            speckleMat: { opacity: 0 },
          },
        }
      )
    )

    // Bare structure → `?? node.def.radius` fallback, `if (fadeUniform)` and
    // `if (speckleMat)` false arms.
    s.nodes.set('shell-bare', makeNode({ kind: 'structure', radius: 5 }, {}))

    // Volumetric cloud with a matching child → find callback + `points?.material`
    // true arm.
    s.nodes.set(
      'mw',
      makeNode(
        { radius: 100, spiralDisc: { volumetric: true } },
        {
          children: [{ userData: { volumetric: true }, material: { opacity: 0 } }],
        }
      )
    )

    // Volumetric cloud with no children → find returns undefined →
    // `points?.material` short-circuit arm.
    s.nodes.set(
      'mw-empty',
      makeNode({ radius: 100, spiralDisc: { volumetric: true } }, { children: [] })
    )

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    tickStar(s, 0)

    const shell = s.nodes.get('shell').mesh

    expect(shell.userData.speckleMat.opacity).toBeGreaterThan(0)
    expect(s.nodes.get('mw').mesh.children[0].material.opacity).toBeGreaterThan(0)

    // Second frame — the `volPoints !== undefined` arm reads the cached
    // Points handle instead of re-walking mesh.children.
    tickStar(s, 1)

    expect(s.nodes.get('mw').volPoints).toBe(s.nodes.get('mw').mesh.children[0])
    expect(s.nodes.get('mw-empty').volPoints).toBeNull()

    // Cached view height drives the angular-size floor — a nonzero
    // s.viewH covers the first arm of the `||` fallback chain; the
    // empty canvas box above already exercised the `clientHeight || 0`
    // arms.
    s.viewH = 500
    s.nodes.get('mw').mesh.children[0].material.size = 1
    tickStar(s, 2)

    expect(s.nodes.get('mw').mesh.children[0].material.size).toBeGreaterThan(0)

    raf.mockRestore()
  })

  test('updateLod returns early when no camera is present', () => {
    const s = makeState({
      camera: null,
      renderer: { render: jest.fn() },
      scene: {},
    })

    s.nodes.set('x', makeNode({ radius: 1 }, {}, { detail: [{}] }))

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    expect(() => tickStar(s, 0)).not.toThrow()

    raf.mockRestore()
  })
})

describe('spiral non-default disc params', () => {
  test('uses explicit thick and halo values instead of defaults', () => {
    const def = {
      id: 'params-test',
      kind: SF_KINDS.GALAXY,
      radius: 100,
      color: 0xffffff,
      tilt: 0,
      spiralDisc: {
        count: 8,
        arms: 2,
        thick: 2.5,
        halo: 0.25,
      },
    }

    const { points } = makeSpiralGalaxy(THREE, def, undefined, undefined, false)

    expect(points).toBeTruthy()
    expect(points.geometry).toBeTruthy()
  })

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
  })
})

describe('maskPhotoTexture', () => {
  test('returns undefined when canvas 2d context is unavailable', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    expect(maskPhotoTexture(THREE, fakePhoto())).toBeUndefined()
  })

  test('keeps the photo when the lobed-mask backing canvas fails', () => {
    let calls = 0

    // First canvas (photo composite) gets a real ctx; the second canvas
    // (the lobe mask inside irregularMask) returns null → `if (!mx) return`.
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => {
      calls += 1

      return calls === 1 ? fake2d() : null
    })

    const out = maskPhotoTexture(THREE, fakePhoto(), { lobes: 4, seed: 'orion' })

    expect(out).toBeTruthy()
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
