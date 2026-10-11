/**
 * @file starfield-follow-tails.test.js
 * @description Coverage tails for frame.ts's orbit-follow — while a
 * catalog body is selected the camera must ride the body's orbit (both
 * the controls target and the camera translate by the anchor's per-frame
 * delta), and every guard arm must be exercised: active fly tween, no
 * selection, missing camera/controls, missing/incomplete anchor, and
 * the zero-delta fast path.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'

import { createStarState } from '../../../../engine/state.js'
import { armFrame, tickStar } from '../../../../engine/frame.js'

/** Mock camera — only the fields followSelected/tickFrame touch. */
const makeCamera = (x = 0, y = 0, z = 900) => ({
  position: {
    x,
    y,
    z,
    set(nx, ny, nz) {
      this.x = nx
      this.y = ny
      this.z = nz
    },
  },
  aspect: 1,
  updateProjectionMatrix: jest.fn(),
})

/** Mock OrbitControls — settable target + update spy. */
const makeControls = (x = 0, y = 0, z = 0) => ({
  target: {
    x,
    y,
    z,
    set(nx, ny, nz) {
      this.x = nx
      this.y = ny
      this.z = nz
    },
  },
  update: jest.fn(),
})

/** Mock anchor whose world position is a fixed point. */
const makeAnchor = (x, y, z) => ({
  getWorldPosition: (v) => {
    v.x = x
    v.y = y
    v.z = z

    return v
  },
})

describe('followSelected orbit-follow', () => {
  test('the camera and target translate by the anchor delta each frame', () => {
    armFrame(class Vec3 {})

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = makeCamera(50, 0, 0)
    s.controls = makeControls(0, 0, 0)
    s.selectedId = 'mars'

    s.anchors.set('mars', makeAnchor(10, 0, 0))

    tickStar(s, 0)

    // Anchor moved to (10,0,0) → both target and camera shift by +10x.
    expect(s.controls.target.x).toBe(10)
    expect(s.camera.position.x).toBe(60)

    // The follow is continuous — a second tick re-glues at the anchor's
    // (unchanged) world position with zero further drift.
    tickStar(s, 16)
    expect(s.controls.target.x).toBe(10)
    expect(s.camera.position.x).toBe(60)
  })

  test('an active fly tween keeps the follow on hold', () => {
    armFrame(class Vec3 {})

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = makeCamera(50, 0, 0)
    s.controls = makeControls(0, 0, 0)
    s.selectedId = 'mars'
    s.anchors.set('mars', makeAnchor(10, 0, 0))
    // A just-started tween (t0 = now) survives updateFly with p < 1, so
    // followSelected must bail on the s.fly guard.
    s.fly = {
      t0: performance.now(),
      fromPos: { x: 50, y: 0, z: 0 },
      toPos: { x: 20, y: 0, z: 0 },
      fromTgt: { x: 0, y: 0, z: 0 },
      toTgt: { x: 10, y: 0, z: 0 },
    }

    tickStar(s, 0)

    expect(s.fly).not.toBeNull()
    // The follow never glued the target — the tween eased it toward the
    // destination instead (x stays < 10).
    expect(s.controls.target.x).toBeLessThan(10)
  })

  test('selection without a camera or controls is a no-op', () => {
    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.selectedId = 'mars'

    // No camera, no controls — the guard returns before the anchor read.
    tickStar(s, 0)

    s.camera = makeCamera()
    s.controls = null

    tickStar(s, 16)
  })

  test('a selection with no anchor — or an unpositionable one — no-ops', () => {
    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = makeCamera(50, 0, 0)
    s.controls = makeControls(0, 0, 0)
    s.selectedId = 'ghost'

    // anchors has no 'ghost' entry at all.
    tickStar(s, 0)
    expect(s.controls.target.x).toBe(0)

    // An anchor that cannot report a world position also bails.
    s.anchors.set('ghost', {})

    tickStar(s, 16)
    expect(s.controls.target.x).toBe(0)
    expect(s.camera.position.x).toBe(50)
  })

  test('a zero-delta frame does not touch the camera', () => {
    armFrame(class Vec3 {})

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = makeCamera(50, 0, 0)
    s.controls = makeControls(10, 0, 0)
    s.selectedId = 'mars'

    // Anchor already sits exactly on the controls target → early return
    // before any translation.
    s.anchors.set('mars', makeAnchor(10, 0, 0))

    tickStar(s, 0)

    expect(s.controls.target.x).toBe(10)
    expect(s.camera.position.x).toBe(50)
  })
})
