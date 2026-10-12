/**
 * @file starfield-follow-tails.test.js
 * @description Coverage tails for frame.ts's floating-origin follow —
 * while a catalog body is followed the engine counter-translates
 * `s.world` so the anchor sits at the origin pin (the camera and the
 * controls target never chase galactic-scale coordinates), and every
 * guard arm must be exercised: active fly tween, no follow, missing
 * world/controls, missing/incomplete anchor.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { SF_CAMERA } from '@core/tokens/starfield/params.js'

import { createStarState } from '../../../../engine/state.js'
import { armFrame, tickStar } from '../../../../engine/frame.js'

/** Mock camera — only the fields tickFrame touches. */
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

/** Mock floating-origin world root — a settable translation vector. */
const makeWorld = () => ({
  position: {
    x: 0,
    y: 0,
    z: 0,
    set(nx, ny, nz) {
      this.x = nx
      this.y = ny
      this.z = nz
    },
  },
})

/**
 * Mock anchor reporting a world position of `s.world.position + local`
 * — the same composition real scene-graph nodes produce, so the pin
 * converges instead of accumulating.
 */
const makeAnchor = (s, x, y, z) => ({
  getWorldPosition: (v) => {
    v.x = s.world.position.x + x
    v.y = s.world.position.y + y
    v.z = s.world.position.z + z

    return v
  },
})

describe('followSelected floating-origin follow', () => {
  test('the world counter-translates so the anchor lands on the origin pin', () => {
    armFrame(class Vec3 {})

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = makeCamera(50, 0, 0)
    s.controls = makeControls(8, 4, 2)
    s.world = makeWorld()
    s.selectedId = 'mars'

    s.anchors.set('mars', makeAnchor(s, 10, 0, 0))

    tickStar(s, 0)

    // World shifted by −10x so the anchor sits exactly on the origin
    // pin; the target snapped to the pin; the camera never moved.
    expect(s.world.position.x).toBe(-10)

    expect(s.controls.target.x).toBe(SF_CAMERA.TARGET_X)
    expect(s.controls.target.y).toBe(SF_CAMERA.TARGET_Y)
    expect(s.controls.target.z).toBe(SF_CAMERA.TARGET_Z)
    expect(s.camera.position.x).toBe(50)

    // The pin is convergent — a second tick keeps the same shift
    // (the anchor's reported world pos already includes it).
    tickStar(s, 16)
    expect(s.world.position.x).toBe(-10)
    expect(s.controls.target.x).toBe(SF_CAMERA.TARGET_X)
  })

  test('the pin runs during a fly tween but leaves the target to the tween', () => {
    armFrame(class Vec3 {})

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = makeCamera(50, 0, 0)
    s.controls = makeControls(8, 4, 2)
    s.world = makeWorld()
    s.selectedId = 'mars'
    s.anchors.set('mars', makeAnchor(s, 10, 0, 0))
    // A just-started tween (t0 = now) survives updateFly with p < 1.
    s.fly = {
      t0: performance.now(),
      fromPos: { x: 50, y: 0, z: 0 },
      offset: { x: 10, y: 0, z: 0 },
      fromTgt: { x: 8, y: 4, z: 2 },
      track: () => ({ x: -10, y: 0, z: 0 }),
      last: { x: -10, y: 0, z: 0 },
    }

    tickStar(s, 0)

    // The world still recentred — but the target was eased by the tween
    // (toward 0 from 8), not snapped.
    expect(s.world.position.x).toBe(-10)
    expect(s.controls.target.x).toBeLessThan(8)
    expect(s.controls.target.x).toBeGreaterThanOrEqual(SF_CAMERA.TARGET_X)
  })

  test('no follow id, no world, or no controls is a no-op', () => {
    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.controls = makeControls(8, 4, 2)
    s.world = makeWorld()
    s.anchors.set('mars', makeAnchor(s, 10, 0, 0))

    // Nothing selected/followed — early return before the anchor read.
    tickStar(s, 0)
    expect(s.world.position.x).toBe(0)

    // A follow id without a world root also bails.
    s.selectedId = 'mars'
    s.world = null

    tickStar(s, 16)
    expect(s.controls.target.x).toBe(8)

    // And no controls: the world may shift but nothing is snapped.
    s.world = makeWorld()
    s.controls = null

    tickStar(s, 32)
    expect(s.world.position.x).toBe(0)
  })

  test('a follow id with no anchor — or an unpositionable one — no-ops', () => {
    armFrame(class Vec3 {})

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.controls = makeControls(8, 4, 2)
    s.world = makeWorld()
    s.selectedId = 'ghost'

    // anchors has no 'ghost' entry at all.
    tickStar(s, 0)
    expect(s.world.position.x).toBe(0)
    expect(s.controls.target.x).toBe(8)

    // An anchor that cannot report a world position also bails.
    s.anchors.set('ghost', {})

    tickStar(s, 16)
    expect(s.world.position.x).toBe(0)
    expect(s.controls.target.x).toBe(8)
  })
})
