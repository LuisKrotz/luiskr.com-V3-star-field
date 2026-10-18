/**
 * @file coverage/starfield/engine/starfield-hint-tails.test.js
 * @description Coverage tails for the navigator-hover position hint —
 * `worldScreenPos` projection (behind-camera mirroring, every edge-clamp
 * arm, on-screen pass-through), `trackHover`'s hint branch (live track
 * resolution + null guards), and `StarFieldEngine.setHint` (clear,
 * catalog-anchor track, registry-record track, and the no-track bail).
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { SF_TIP } from '@core/tokens/starfield/params.js'

import { worldScreenPos } from '../../../../engine/frame/camera.js'
import { armFrame } from '../../../../engine/frame.js'
import { trackHover } from '../../../../engine/frame/updates.js'
import { createStarState } from '../../../../engine/state.js'

/** Bootstrap mock — fills just enough state for setHint's arms. */
jest.unstable_mockModule('../../../../engine/bootstrap.js', () => ({
  armFrame: jest.fn(),
  armPicking: jest.fn(),
  bootstrapStarField: jest.fn(async (s) => {
    s.scene = { isScene: true }
    s.world = { position: { x: 0, y: 0, z: 0, set: jest.fn() } }
    s.nodes.set('milky-way', { def: { pos: [-267, 0, 0], tilt: 0.35 } })
    s.nodes.set('sun', {
      def: { radius: 12 },
      pivot: {
        getWorldPosition: (v) => {
          v.x = 0
          v.y = 0
          v.z = 0

          return v
        },
      },
      spinner: { rotation: { y: 0 } },
      satPivots: [],
    })
    s.anchors.set('mars', {
      getWorldPosition: (v) => {
        v.x = 10
        v.y = 0
        v.z = 0

        return v
      },
    })
  }),
}))

const { StarFieldEngine } = await import('../../../../starfield-engine.js')

/** Controllable-NDC Vector3 mock — instances carry set + project. */
let _ndc = { x: 0, y: 0, z: 0 }
class MockVec3 {
  set(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
  }
  project() {
    return _ndc
  }
}

const makeCanvas = () => ({ clientWidth: 400, clientHeight: 400 })

const makeState = () => ({ camera: { position: { x: 0, y: 0, z: 0 } }, canvas: makeCanvas() })

beforeEach(() => {
  _ndc = { x: 0, y: 0, z: 0 }
})

describe('worldScreenPos edge-clamped projection', () => {
  test('guards: null point, unarmed vec3, missing camera/canvas', () => {
    armFrame(MockVec3)

    const s = makeState()

    expect(worldScreenPos(null, s)).toBeNull()
    expect(worldScreenPos({ x: 0, y: 0, z: 0 }, { camera: s.camera })).toBeNull()
    expect(worldScreenPos({ x: 0, y: 0, z: 0 }, { canvas: s.canvas })).toBeNull()
  })

  test('a vec3 without set() assigns components directly; without project() it bails', () => {
    armFrame(class BareVec3 {})

    expect(worldScreenPos({ x: 1, y: 2, z: 3 }, makeState())).toBeNull()
  })

  test('on-screen points pass through unclamped with no edge flag or angle', () => {
    armFrame(MockVec3)

    _ndc = { x: 0, y: 0, z: 0 }

    const p = worldScreenPos({ x: 1, y: 2, z: 3 }, makeState())

    expect(p).toEqual({ x: 200, y: 200, edge: false, angle: undefined })
  })

  test('the cached viewW/viewH box wins over a live clientWidth read', () => {
    armFrame(MockVec3)

    _ndc = { x: 0, y: 0, z: 0 }

    const s = { ...makeState(), viewW: 800, viewH: 200 }

    const p = worldScreenPos({ x: 1, y: 2, z: 3 }, s)

    expect(p).toEqual({ x: 400, y: 100, edge: false, angle: undefined })
  })

  test('behind-camera points mirror through the centre and clamp to the edge', () => {
    armFrame(MockVec3)

    // Behind → mirrored to ndc (+0.8, +0.8) → projected off the right/top.
    _ndc = { x: -0.8, y: -0.8, z: 2 }

    const s = makeState()

    const p = worldScreenPos({ x: 0, y: 0, z: 0 }, s)

    expect(p.edge).toBe(true)
    expect(p.x).toBe(400 - SF_TIP.EDGE_PAD)
    expect(p.y).toBe(SF_TIP.EDGE_PAD)
    expect(typeof p.angle).toBe('number')
  })

  test('each side clamps independently — left, right, top, bottom', () => {
    armFrame(MockVec3)

    const s = makeState()
    const pad = SF_TIP.EDGE_PAD

    _ndc = { x: -4, y: 0, z: 0 }
    expect(worldScreenPos({ x: 0, y: 0, z: 0 }, s).x).toBe(pad)

    _ndc = { x: 4, y: 0, z: 0 }
    expect(worldScreenPos({ x: 0, y: 0, z: 0 }, s).x).toBe(400 - pad)

    _ndc = { x: 0, y: 4, z: 0 }
    expect(worldScreenPos({ x: 0, y: 0, z: 0 }, s).y).toBe(pad)

    _ndc = { x: 0, y: -4, z: 0 }
    expect(worldScreenPos({ x: 0, y: 0, z: 0 }, s).y).toBe(400 - pad)
  })

  test('zero-size canvas and missing project return null', () => {
    armFrame(MockVec3)

    expect(
      worldScreenPos(
        { x: 0, y: 0, z: 0 },
        { camera: {}, canvas: { clientWidth: 0, clientHeight: 0 } }
      )
    ).toBeNull()
  })
})

describe('trackHover hint branch', () => {
  test('the hint anchor resolves live and reports edge-clamped pixels', () => {
    armFrame(MockVec3)

    _ndc = { x: 4, y: 0, z: 0 }

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS), {
      onHoverMove: jest.fn(),
    })

    s.camera = { position: { x: 0, y: 0, z: 0 } }
    s.canvas = makeCanvas()
    s.hint = {
      id: 'jupiter',
      anchor: { getWorldPosition: (v) => v },
      rec: null,
    }
    s.hoverId = 'mars' // the hint wins over the stale raycast hover

    trackHover(s)

    expect(s.onHoverMove).toHaveBeenCalledWith(
      'jupiter',
      400 - SF_TIP.EDGE_PAD,
      200,
      true,
      expect.any(Number)
    )
  })

  test('a registry hint resolves through the shard record; bare hints report nothing', () => {
    armFrame(MockVec3)

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS), {
      onHoverMove: jest.fn(),
    })

    s.camera = {}
    s.canvas = makeCanvas()

    // No Milky Way node → registryWorldPos resolves null → no report.
    s.hint = { id: 'star-000001', anchor: null, rec: { i: 'star-000001', x: 1, y: 2, z: 3 } }

    trackHover(s)

    expect(s.onHoverMove).not.toHaveBeenCalled()

    // Neither anchor nor record → p resolves null → still no report.
    s.hint = { id: 'ghost', anchor: null, rec: null }

    trackHover(s)

    expect(s.onHoverMove).not.toHaveBeenCalled()
  })
})

describe('StarFieldEngine.setHint', () => {
  const makeCanvasEl = () =>
    Object.assign(window.document.createElement('canvas'), {
      getRootNode: () => window.document,
    })

  test('catalog ids arm an anchor track and echo onHover', async () => {
    const onHover = jest.fn()
    const eng = new StarFieldEngine(makeCanvasEl(), { onHover })

    await eng.init()

    eng.setHint('mars')
    expect(onHover).toHaveBeenCalledWith('mars')

    // Clearing disarms the hint and echoes null.
    onHover.mockClear()
    eng.setHint(null)
    expect(onHover).toHaveBeenCalledWith(null)

    eng.destroy()
  })

  test('registry rows arm a shard-position track; unknown ids bail silently', async () => {
    const onHover = jest.fn()
    const eng = new StarFieldEngine(makeCanvasEl(), { onHover })

    await eng.init()

    eng.setHint('star-000000', { i: 'star-000000', x: 1, y: 2, z: 3 })
    expect(onHover).toHaveBeenCalledWith('star-000000')

    onHover.mockClear()

    // No anchor and no record → no track, no hint, no echo.
    eng.setHint('ghost')
    expect(onHover).not.toHaveBeenCalled()

    eng.destroy()
  })
})
