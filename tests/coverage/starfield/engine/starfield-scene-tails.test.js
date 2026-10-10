/**
 * @file coverage/starfield/engine/starfield-scene-tails.test.js
 * @description Coverage tails for the engine internals that need a
 * real decode path — star-cloud binary parsing (records, kinds, far
 * clamp, malformed buffers, dispose), frame.ts anchorScreenPos
 * projection arms and the LOD detail toggle, spiral defaults/mobile
 * divisor/points raycast noop, and the satellite colorless arm in
 * bodies-scene.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { ensureStarCloud, disposeStarCloud } from '../../../../engine/star-cloud.js'
import {
  anchorScreenPos,
  armFrame,
  rotateStarCamera,
  tickStar,
} from '../../../../engine/frame.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { buildStarBodies } from '../../../../engine/bodies-scene.js'
import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'

/** TSL namespace + node-material ctor bundle injected into body makers. */
const NODE_DEPS = { TSL, mats: { MeshBasicNodeMaterial } }

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/** Encodes a fake deep-field binary: uint32 count + stride-6 float records. */
const packCloud = (records) => {
  const buf = new ArrayBuffer(4 + records.length * 6 * 4)
  const dv = new DataView(buf)

  dv.setUint32(0, records.length, true)

  records.forEach((r, i) => {
    r.forEach((v, j) => dv.setFloat32(4 + i * 24 + j * 4, v, true))
  })

  return buf
}

let origFetch

beforeEach(() => {
  origFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = origFetch
})

describe('star-cloud decode + mount', () => {
  const mwState = () => ({
    starCloud: null,
    starCloudLoading: false,
    disposed: false,
    nodes: new Map([
      ['sun', { pivot: { add: jest.fn() }, def: {} }],
      ['milky-way', { pivot: { add: jest.fn() }, def: { tilt: 0.35 } }],
    ]),
  })

  test('decodes a real binary, mounts on the Sun pivot and disposes', async () => {
    const buf = packCloud([
      // kind 0 star, spectral-blue ci
      [-5, -6, -1, -1.4, -0.2, 0],
      // kind 0 star, mid ci (white ramp)
      [3, 4, 5, 3.0, 0.3, 0],
      // kind 0 star, gold ramp
      [1, 0, 0, 5.0, 0.6, 0],
      // kind 0 star, orange/red ramp
      [0, 1, 0, 7.0, 1.2, 0],
      // kind 0 star, deep red
      [0, 0, 1, 9.0, 2.1, 0],
      // zero-distance record → `dLy > 0 ? … : 0` fallback arm
      [0, 0, 0, 5.0, 0.5, 0],
      // kind 1 exoplanet
      [10, 20, 30, 7.5, 0.85, 1],
      // kind 2 dso — far-field clamp
      [1e9, 0, 0, 10.0, 1.1, 2],
    ])

    globalThis.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buf }))

    const s = mwState()

    ensureStarCloud(s, THREE)
    await flush(20)

    expect(s.starCloud).toBeTruthy()
    expect(s.nodes.get('sun').pivot.add).toHaveBeenCalled()

    // Repeat call no-ops while a cloud is mounted.
    ensureStarCloud(s, THREE)

    disposeStarCloud(s)
    expect(s.starCloud).toBeNull()
  })

  test('malformed buffers resolve without mounting', async () => {
    // Zero-count header.
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new DataView(new ArrayBuffer(4)).buffer,
    }))

    const s = mwState()

    ensureStarCloud(s, THREE)
    await flush(20)

    expect(s.starCloud).toBeNull()

    // Truncated payload — header promises more than the body holds.
    const short = new ArrayBuffer(8)
    new DataView(short).setUint32(0, 99, true)

    globalThis.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => short }))

    ensureStarCloud(s, THREE)
    await flush(20)

    expect(s.starCloud).toBeNull()
  })

  test('fetch failure and dispose mid-load are no-ops', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))

    const s = mwState()

    ensureStarCloud(s, THREE)
    await flush(20)

    expect(s.starCloud).toBeNull()

    // Loading-guard arm — second call while in-flight doesn't refetch.
    const s2 = mwState()

    globalThis.fetch = jest.fn(async () => new Promise(() => {}))

    ensureStarCloud(s2, THREE)
    ensureStarCloud(s2, THREE)

    expect(s2.starCloudLoading).toBe(true)
    s2.starCloudLoading = false

    // Disposed-state guard — no additional fetch beyond the in-flight one.
    const s3 = mwState()

    s3.disposed = true
    ensureStarCloud(s3, THREE)

    expect(globalThis.fetch.mock.calls.length).toBe(1)
  })

  test('decoded cloud skips mounting when the MW node is absent', async () => {
    const buf = packCloud([[1, 2, 3, 4, 0.5, 0]])

    globalThis.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buf }))

    const s = {
      starCloud: null,
      starCloudLoading: false,
      disposed: false,
      nodes: new Map(),
    }

    ensureStarCloud(s, THREE)
    await flush(20)

    // Cloud still parks on state — it just never mounts on a pivot.
    expect(s.starCloud).toBeTruthy()

    // The no-op raycast guard on the points object.
    s.starCloud.raycast()

    disposeStarCloud(s)
  })

  test('MW node without a tilt uses the zero-tilt arm', async () => {
    const buf = packCloud([[1, 2, 3, 4, 0.5, 0]])

    globalThis.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buf }))

    const s = {
      starCloud: null,
      starCloudLoading: false,
      disposed: false,
      nodes: new Map([
        ['sun', { pivot: { add: jest.fn() }, def: {} }],
        ['milky-way', { pivot: { add: jest.fn() }, def: {} }],
      ]),
    }

    ensureStarCloud(s, THREE)
    await flush(20)

    expect(s.nodes.get('sun').pivot.add).toHaveBeenCalled()

    disposeStarCloud(s)
  })
})

describe('frame projection + LOD', () => {
  const fakeAnchor = (ndc) => ({
    getWorldPosition: () => ({ x: 1, y: 2, z: 3, project: () => ndc }),
  })

  test('anchorScreenPos projects to canvas px and rejects edge cases', () => {
    armFrame(THREE.Vector3, THREE.Color)

    const s = { camera: {}, canvas: { clientWidth: 200, clientHeight: 100 } }

    const p = anchorScreenPos(fakeAnchor({ x: 0, y: 0, z: 0 }), s)

    expect(p).toEqual({ x: 100, y: 50 })

    // Behind the camera → null.
    expect(anchorScreenPos(fakeAnchor({ x: 0, y: 0, z: 2 }), s)).toBeNull()

    // Anchor without getWorldPosition → null.
    expect(anchorScreenPos({}, s)).toBeNull()

    // getWorldPosition without project → null.
    expect(
      anchorScreenPos({ getWorldPosition: () => ({ x: 0, y: 0, z: 0 }) }, s)
    ).toBeNull()

    // No camera / zero-size canvas → null.
    expect(anchorScreenPos(fakeAnchor({ x: 0, y: 0, z: 0 }), { canvas: s.canvas })).toBeNull()

    expect(
      anchorScreenPos(fakeAnchor({ x: 0, y: 0, z: 0 }), {
        camera: {},
        canvas: { clientWidth: 0, clientHeight: 100 },
      })
    ).toBeNull()
  })

  test('tickStar drives updateLod + trackHover through the real tick path', () => {
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)

    armFrame(THREE.Vector3, THREE.Color)

    const detail = [{ visible: true }, { visible: true }]
    const farDetail = [{ visible: true }]
    const hoverAnchor = { getWorldPosition: () => ({ x: 0, y: 0, z: 0, project: () => ({ x: 0, y: 0, z: 0 }) }) }

    const s = {
      animId: 0,
      disposed: false,
      reduced: false,
      lastT: 0,
      t: 0,
      hoverId: 'mars',
      onHoverMove: jest.fn(),
      anchors: new Map([['mars', hoverAnchor]]),
      camera: { position: { x: 0, y: 0, z: 0 } },
      canvas: { clientWidth: 200, clientHeight: 100 },
      controls: null,
      renderer: null,
      scene: null,
      nodes: new Map([
        [
          'near',
          {
            detail,
            mesh: { getWorldPosition: () => ({ x: 1, y: 0, z: 0 }) },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            def: { radius: 5, orbit: 2 },
          },
        ],
        [
          'far',
          {
            detail: farDetail,
            mesh: { getWorldPosition: () => ({ x: 1e9, y: 0, z: 0 }) },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            def: { radius: 1 },
          },
        ],
        [
          'noDetail',
          {
            detail: [],
            mesh: {},
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            def: { radius: 1 },
          },
        ],
      ]),
    }

    tickStar(s, 16)

    // LOD: near body's detail stays visible, far body's flips off.
    expect(detail.every((o) => o.visible)).toBe(true)
    expect(farDetail[0].visible).toBe(false)

    // Hover re-projection reports canvas px via onHoverMove.
    expect(s.onHoverMove).toHaveBeenCalledWith('mars', expect.any(Number), expect.any(Number))

    // Reduced-motion + disposed early-outs.
    s.reduced = true
    tickStar(s, 32)

    s.reduced = false
    s.disposed = true
    tickStar(s, 48)

    // Hover gone — trackHover no-ops.
    s.disposed = false
    s.hoverId = null
    s.onHoverMove.mockClear()
    tickStar(s, 64)

    expect(s.onHoverMove).not.toHaveBeenCalled()

    // Anchor missing from the map — early out inside trackHover.
    s.hoverId = 'ghost'
    tickStar(s, 80)

    expect(s.onHoverMove).not.toHaveBeenCalled()

    // Anchor present but projecting behind the camera — pos-null arm.
    s.hoverId = 'behind'
    s.anchors.set(
      'behind',
      fakeAnchor({ x: 0, y: 0, z: 2 })
    )
    tickStar(s, 96)

    expect(s.onHoverMove).not.toHaveBeenCalled()

    raf.mockRestore()
  })
})

describe('rotateStarCamera orbit math', () => {
  const orbitState = (cam, tgt = { x: 0, y: 0, z: 0 }) => ({
    fly: { stub: true },
    camera: { position: { ...cam, set: jest.fn() } },
    controls: { target: { ...tgt }, update: jest.fn() },
  })

  test('no-ops without camera or controls', () => {
    rotateStarCamera({}, 0.1, 0.1)
    rotateStarCamera({ camera: {} }, 0.1, 0.1)
    rotateStarCamera({ controls: {} }, 0.1, 0.1)
  })

  test('no-ops when the camera sits exactly on the target', () => {
    const s = orbitState({ x: 0, y: 0, z: 0 })

    rotateStarCamera(s, 0.1, 0.1)

    expect(s.camera.position.set).not.toHaveBeenCalled()
    expect(s.fly).toBeNull()
  })

  test('rotates the camera around the target and clamps the polar angle', () => {
    const s = orbitState({ x: 0, y: 0, z: 10 })

    rotateStarCamera(s, Math.PI / 4, 0)

    // r preserved, theta advanced — camera swung to +X.
    const [nx, ny, nz] = s.camera.position.set.mock.calls[0]

    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(10)
    expect(nx).toBeCloseTo(10 * Math.sin(Math.PI / 4), 5)
    expect(ny).toBeCloseTo(0, 5)
    expect(nz).toBeCloseTo(10 * Math.cos(Math.PI / 4), 5)
    expect(s.controls.update).toHaveBeenCalled()

    // dPolar negative enough to run past the far pole → clamped at PI - PHI_MIN.
    s.camera.position.set = jest.fn()

    rotateStarCamera(s, 0, -Math.PI * 2)

    const [cx, cy, cz] = s.camera.position.set.mock.calls[0]

    // phi clamped to PI - PHI_MIN → y ≈ -r·cos(PHI_MIN).
    expect(cy).toBeLessThan(0)
    expect(Math.hypot(cx, cy, cz)).toBeCloseTo(10)
  })
})

describe('spiral + satellite arms', () => {
  test('makeSpiralGalaxy honors defaults, arm overrides and the mobile divisor', () => {
    // No spiralDisc → default count/arms; empty texMap → procedural fallback.
    const a = makeSpiralGalaxy(THREE, { id: 'g1', radius: 10, tilt: 0.1 }, new Map(), undefined, false)

    expect(a.group).toBeTruthy()
    expect(a.pick).toBeTruthy()

    // Explicit count + arms + mobile divisor.
    const b = makeSpiralGalaxy(
      THREE,
      { id: 'g2', radius: 10, tilt: 0.1, spiralDisc: { count: 4000, arms: 2 } },
      undefined,
      undefined,
      true
    )

    expect(b.group).toBeTruthy()

    // Tilt-less def — no tilt applied; texMap absent entirely.
    makeSpiralGalaxy(THREE, { id: 'g3', radius: 5 }, undefined, undefined, false)

    // Omitted `mobile` arg → default arm; invoke the raycast no-op.
    const c = makeSpiralGalaxy(THREE, { id: 'g4', radius: 5, tilt: 0.1 }, undefined, undefined)

    expect(c.points.raycast()).toBeUndefined()

    // Elliptical + color-less → `color ?? DWARF_SPH` tint fallback.
    const d = makeSpiralGalaxy(
      THREE,
      { id: 'g5', radius: 5, spiralDisc: { elliptical: true, count: 64 } },
      undefined,
      undefined,
      false
    )

    expect(d.group).toBeTruthy()

    // Heliocentric bubble with `pos` but no `tilt` → `tilt ?? 0` arm
    // inside the bubble transform.
    const e = makeSpiralGalaxy(
      THREE,
      { id: 'g6', radius: 5, pos: [267, 0, 0], spiralDisc: { count: 64, bubble: 10 } },
      undefined,
      undefined,
      false
    )

    expect(e.points).toBeTruthy()
  })

  test('buildStarBodies covers the satellite phase-default + galaxy arms', () => {
    const defs = [
      {
        id: 'probe-planet',
        name: 'Probe',
        kind: 'planet',
        radius: 2,
        orbit: 10,
        speed: 0.5,
        color: 0xff0000,
        satellites: [{ id: 'probe-moon', name: 'Moon', radius: 0.4, orbit: 3, speed: 1 }],
      },
      // Spiral galaxy def — s has no canvas → `?? 0` mobile-width arm.
      {
        id: 'probe-galaxy',
        name: 'Galaxy',
        kind: 'galaxy',
        radius: 50,
        spiralDisc: { count: 100, arms: 2 },
        tilt: 0.2,
      },
      // Non-spiral galaxy → plain disc path.
      {
        id: 'probe-elliptical',
        name: 'Elliptical',
        kind: 'galaxy',
        radius: 40,
      },
    ]

    const s = {
      scene: new THREE.Scene(),
      nodes: new Map(),
      anchors: new Map(),
      pickables: [],
      mwGroup: null,
    }

    buildStarBodies(s, THREE, NODE_DEPS, defs, new Map(), undefined)

    expect(s.nodes.size).toBe(3)
    expect(s.nodes.get('probe-planet').satPivots[0].phase).toBe(0)
    expect(s.nodes.get('probe-galaxy')).toBeTruthy()
    expect(s.nodes.get('probe-elliptical')).toBeTruthy()
  })
})
