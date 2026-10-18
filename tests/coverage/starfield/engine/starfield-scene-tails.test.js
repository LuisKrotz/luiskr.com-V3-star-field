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
import { anchorScreenPos, armFrame, rotateStarCamera, tickStar } from '../../../../engine/frame.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { buildStarBodies } from '../../../../engine/bodies-scene.js'
import { SF_KINDS } from '../../../../../../core/tokens/starfield/kinds.js'
import * as THREE from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
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

    // Cached box arm — s.viewW/s.viewH (written by handleStarResize)
    // take precedence over a live clientWidth/clientHeight read.
    const cached = {
      camera: {},
      canvas: { clientWidth: 200, clientHeight: 100 },
      viewW: 400,
      viewH: 200,
    }

    expect(anchorScreenPos(fakeAnchor({ x: 0, y: 0, z: 0 }), cached)).toEqual({
      x: 200,
      y: 100,
    })

    // Behind the camera → null.
    expect(anchorScreenPos(fakeAnchor({ x: 0, y: 0, z: 2 }), s)).toBeNull()

    // Anchor without getWorldPosition → null.
    expect(anchorScreenPos({}, s)).toBeNull()

    // getWorldPosition without project → null.
    expect(anchorScreenPos({ getWorldPosition: () => ({ x: 0, y: 0, z: 0 }) }, s)).toBeNull()

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
    const hoverAnchor = {
      getWorldPosition: () => ({ x: 0, y: 0, z: 0, project: () => ({ x: 0, y: 0, z: 0 }) }),
    }

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
    s.anchors.set('behind', fakeAnchor({ x: 0, y: 0, z: 2 }))
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
    const a = makeSpiralGalaxy(
      THREE,
      { id: 'g1', radius: 10, tilt: 0.1 },
      new Map(),
      undefined,
      false
    )

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
        satellites: [{ radius: 0.4, orbit: 3, speed: 1 }],
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

  test('an id-carrying satellite registers as a pickable dossier body', () => {
    const defs = [
      {
        id: 'probe-earth',
        name: 'Probe Earth',
        kind: 'planet',
        group: 'solar',
        radius: 2,
        orbit: 10,
        speed: 0.5,
        satellites: [
          // Anonymous companion with an authored photo — the
          // `texMap.get(sat.texture)` hit arm in makeSatellites.
          { radius: 0.2, orbit: 4, speed: 2, texture: '/probe-sat.jpg' },
          {
            id: 'probe-station',
            name: 'Station',
            radius: 0.1,
            orbit: 3,
            speed: 3,
            station: true,
          },
        ],
      },
    ]

    const s = {
      scene: new THREE.Scene(),
      nodes: new Map(),
      anchors: new Map(),
      pickables: [],
      mwGroup: null,
    }

    buildStarBodies(
      s,
      THREE,
      NODE_DEPS,
      defs,
      new Map([['/probe-sat.jpg', { fake: true }]]),
      undefined
    )

    const sat = s.nodes.get('probe-station')

    expect(sat).toBeTruthy()
    expect(sat.def.kind).toBe(SF_KINDS.SATELLITE)
    expect(sat.def.parent).toBe('probe-earth')
    expect(s.anchors.get('probe-station')).toBe(sat.mesh)
    expect(s.pickables.includes(sat.mesh)).toBe(true)
    // Anonymous companion stays decorative — no node, no anchor.
    expect(s.nodes.size).toBe(2)
  })

  test('an id-carrying constellation shell registers as a pickable dossier body', () => {
    const defs = [
      // Swarm with an id but no name — the `name ?? id` fallback arm.
      {
        id: 'probe-terra',
        name: 'Terra',
        kind: 'planet',
        group: 'solar',
        radius: 2,
        orbit: 10,
        speed: 0.5,
        constellation: { count: 8, orbit: 2, id: 'probe-swarm' },
      },
      // Swarm without an id — stays decorative: no node, no pickable.
      {
        id: 'probe-quiet',
        name: 'Quiet',
        kind: 'planet',
        group: 'solar',
        radius: 2,
        orbit: 20,
        speed: 0.3,
        constellation: { count: 8, orbit: 2 },
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

    const swarm = s.nodes.get('probe-swarm')

    expect(swarm).toBeTruthy()
    expect(swarm.def.kind).toBe(SF_KINDS.SATELLITE)
    expect(swarm.def.name).toBe('probe-swarm')
    expect(swarm.def.parent).toBe('probe-terra')
    expect(s.anchors.get('probe-swarm')).toBe(swarm.mesh)
    expect(s.pickables.includes(swarm.mesh)).toBe(true)
    // Anonymous swarm — host node only, no dossier registration.
    expect(s.nodes.size).toBe(3)
    expect(s.nodes.get('probe-quiet')).toBeTruthy()
  })
})

describe('day/night + axis-lock tails', () => {
  const NODE_DEPS_STD = {
    TSL,
    mats: { MeshBasicNodeMaterial, MeshStandardNodeMaterial },
  }

  const anchorAt = (x, y, z) => ({
    getWorldPosition: (v) => {
      v.x = x
      v.y = y
      v.z = z

      return v
    },
  })

  /** Plain {x,y,z,set} stand-in — the auto-mock's Vector3 swallows sets. */
  const dirVec = () => ({
    x: 0,
    y: 0,
    z: 0,
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
    },
  })

  test('updateDayNight writes normalized sun directions and survives every guard', async () => {
    const { updateDayNight } = await import('../../../../engine/frame/updates.js')

    armFrame(THREE.Vector3, THREE.Color)

    // Empty/undefined registries and a missing sun light all bail early.
    updateDayNight({})
    updateDayNight({ dayNight: [] })
    updateDayNight({ dayNight: [{ anchor: {}, dir: dirVec() }] })

    const dir = dirVec()

    const s = {
      sunLight: anchorAt(100, 0, 0),
      dayNight: [
        { anchor: anchorAt(0, 0, 0), dir },
        // Coincident body — the len>0 guard leaves the zero vector.
        { anchor: anchorAt(100, 0, 0), dir: dirVec() },
        // Anchor spun 90° about Y — world +X reads as local +Z in the
        // mesh frame so the day side sweeps the globe as it rotates.
        {
          anchor: {
            ...anchorAt(0, 0, 0),
            matrixWorld: { elements: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] },
          },
          dir: dirVec(),
        },
      ],
    }

    updateDayNight(s)

    expect(dir.x).toBeCloseTo(1)
    expect(dir.y).toBeCloseTo(0)
    expect(dir.z).toBeCloseTo(0)
    expect(s.dayNight[1].dir).toEqual({ x: 0, y: 0, z: 0, set: expect.any(Function) })
    expect(s.dayNight[2].dir.x).toBeCloseTo(0)
    expect(s.dayNight[2].dir.y).toBeCloseTo(0)
    expect(s.dayNight[2].dir.z).toBeCloseTo(1)
  })

  test('tilted orbiting bodies get an inertial lock; moons keep the mesh tilt', async () => {
    // Recording Group — the auto-mock's chain proxy swallows
    // `rotation.z = tilt`, so a plain class stores it for assertion.
    class RecGroup {
      constructor() {
        this.rotation = { x: 0, y: 0, z: 0 }
        this.position = {
          x: 0,
          y: 0,
          z: 0,
          set(px, py, pz) {
            this.x = px
            this.y = py
            this.z = pz
          },
        }
        this.children = []
      }
      add(c) {
        this.children.push(c)
      }
    }

    const T = { ...THREE, Group: RecGroup }

    const s = {
      scene: new THREE.Scene(),
      world: new THREE.Group(),
      nodes: new Map(),
      anchors: new Map(),
      pickables: [],
      dayNight: [],
    }

    const defs = [
      {
        id: 'tilted',
        kind: 'planet',
        radius: 2,
        orbit: 10,
        speed: 1,
        tilt: 0.41,
        color: 0x8899aa,
      },
      {
        id: 'tilted-moon',
        kind: 'moon',
        radius: 1,
        orbit: 3,
        parent: 'tilted',
        speed: 2,
        tilt: 0.1,
        color: 0xaaaaaa,
      },
      {
        id: 'earth-like',
        kind: 'planet',
        radius: 1.7,
        orbit: 39,
        speed: 1,
        tilt: 0.41,
        texture: '/day.jpg',
        emissiveTexture: '/night.jpg',
        atmosphere: 1,
      },
    ]

    const texMap = new Map([
      ['/day.jpg', { fake: true }],
      ['/night.jpg', { fake: true }],
    ])

    buildStarBodies(s, T, NODE_DEPS_STD, defs, texMap, undefined)

    const planet = s.nodes.get('tilted')

    // Axis lock — tilt on the lock's z; the mesh rides inside the lock,
    // and the lock sits inside `center` (the orbit-offset carrier) so
    // the −θ counter-rotation fixes orientation, never the position.
    expect(planet.lock).toBeInstanceOf(RecGroup)
    expect(planet.lock.rotation.z).toBeCloseTo(0.41)
    expect(planet.lock.children).toContain(planet.mesh)
    expect(planet.center.position.x).toBe(10)
    expect(planet.center.children).toContain(planet.lock)

    // The moon is tidally locked by rigid co-rotation — no counter-
    // rotating group (that would collapse its position onto the
    // parent's +X ray); the mesh rides `center` directly so it orbits
    // the parent while showing the same face, and its tilt lives on
    // the mesh inside that frame.
    const moon = s.nodes.get('tilted-moon')

    expect(moon.lock).toBeUndefined()
    expect(moon.center.position.x).toBe(3)
    expect(moon.center.children).toContain(moon.mesh)
    expect(s.anchors.get('tilted-moon')).toBe(moon.center)

    // The day/night registry picked up the emissive+atmosphere body.
    expect(s.dayNight.length).toBe(1)
    expect(s.dayNight[0].anchor).toBe(s.nodes.get('earth-like').mesh)

    // Node-material emissive gating + the atmosphere shell in detail.
    expect(s.nodes.get('earth-like').mesh.material.emissiveNode).toBeTruthy()
    expect(s.nodes.get('earth-like').detail.length).toBeGreaterThan(0)

    // Classic-material fallback — without MeshStandardNodeMaterial the
    // day/night registry still gets a sunDir but the emissive map falls
    // back to the unlit emissiveMap path.
    const s2 = {
      scene: new THREE.Scene(),
      world: new THREE.Group(),
      nodes: new Map(),
      anchors: new Map(),
      pickables: [],
      dayNight: [],
    }

    buildStarBodies(
      s2,
      T,
      { TSL, mats: { MeshBasicNodeMaterial } },
      [
        {
          id: 'legacy-earth',
          kind: 'planet',
          radius: 1,
          orbit: 10,
          speed: 1,
          emissiveTexture: '/night.jpg',
        },
      ],
      texMap,
      undefined
    )

    expect(s2.dayNight.length).toBe(1)

    // Atmosphere shell with a default opacity — the `?? 1` arm the
    // guarded caller (def.atmosphere && dn) can never reach.
    const { makeAtmoShell } = await import('../../../../engine/bodies/primitives.js')

    expect(makeAtmoShell(THREE, NODE_DEPS_STD, { radius: 1 }, dirVec())).toBeTruthy()
  })

  test('tickFrame counter-rotates the lock and updateFx syncs cycle to the orbit', async () => {
    const { updateFx } = await import('../../../../engine/frame/fx.js')

    armFrame(THREE.Vector3, THREE.Color)

    const lock = { rotation: { y: 0, z: 0.41 } }
    const pivot = { rotation: { y: 0 } }
    const lerpColors = jest.fn()
    const lerpRogue = jest.fn()

    const s = {
      animId: 0,
      disposed: false,
      reduced: false,
      lastT: 0,
      t: 0,
      nodes: new Map([
        [
          'earth',
          {
            def: { orbit: 39, speed: 1, cycle: { period: 90 } },
            pivot,
            lock,
            mesh: { material: { color: { lerpColors } } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
          },
        ],
        [
          // Free-running glaciation — no axis lock, so the tint keeps
          // its wall-clock sine instead of syncing to an orbit.
          'rogue',
          {
            def: { cycle: { period: 90 } },
            pivot: { rotation: { y: 0 } },
            mesh: { material: { color: { lerpColors: lerpRogue } } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
          },
        ],
      ]),
      camera: { position: { x: 0, y: 0, z: 0 } },
      controls: null,
      renderer: null,
      scene: null,
      canvas: null,
    }

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)

    tickStar(s, 16)

    raf.mockRestore()

    // Orbit advanced θ → the lock cancels it exactly on its own Y.
    expect(pivot.rotation.y).toBeGreaterThan(0)
    expect(lock.rotation.y).toBeCloseTo(-pivot.rotation.y)

    // Cycle k = 0.5 + 0.5·cos(θ) — orbit-synced seasons, not wall time.
    expect(lerpColors.mock.calls[0][2]).toBeCloseTo(0.5 + 0.5 * Math.cos(pivot.rotation.y))

    // The unlocked body keeps the free-running sine on s.t.
    expect(lerpRogue.mock.calls[0][2]).toBeCloseTo(0.5 + 0.5 * Math.sin((2 * Math.PI * s.t) / 90))

    updateFx(s)
  })

  test('updateFx breathes flares and fires/fades the meteor pool', async () => {
    const { updateFx } = await import('../../../../engine/frame/fx.js')

    // Flare pair — one sprite with a material (opacity arm), one
    // without (the `if (spr.material)` else arm).
    const flares = [
      {
        sprite: { material: { opacity: 0 }, scale: { set: jest.fn() } },
        rate: 1,
        phase: 0,
        base: 2,
      },
      { sprite: { scale: { set: jest.fn() } }, rate: 1, phase: 2, base: 1 },
    ]

    // Meteor slots: dormant (fires on trigger → continue + activate arms),
    // live-with-material (rise/decay + expire-fade arms) and live-but-
    // material-less (both `mat.material` false arms).
    const slotA = {
      sprite: { position: { set: jest.fn() }, material: { opacity: 0 } },
      t0: -1,
      active: false,
    }
    const slotB = {
      sprite: { position: { set: jest.fn() }, material: { opacity: 0 } },
      t0: 0,
      active: true,
    }
    const slotC = { sprite: { position: { set: jest.fn() } }, t0: 0, active: true }

    const node = {
      def: { radius: 2 },
      pivot: { rotation: { y: 0 } },
      spinner: { rotation: { y: 0 } },
      satPivots: [],
      mesh: {},
      flares,
      meteorPool: [slotA, slotB, slotC],
      meteorNext: 0,
    }

    const s = {
      t: -1,
      fxTime: { value: 0 },
      solarWind: { value: 0 },
      nodes: new Map([['sun', node]]),
    }

    // Below the schedule → no trigger; the inactive slot hits
    // `!slot.active continue`, the material-less live slot hits the
    // `else if (mat.material)` false arm.
    updateFx(s)

    expect(slotA.active).toBe(false)

    // Past the schedule → the dormant slot fires at a surface point and
    // the clock re-arms.
    s.t = 0.6

    updateFx(s)

    expect(slotA.active).toBe(true)
    expect(slotA.sprite.position.set).toHaveBeenCalled()

    // Force every slot busy with a due trigger — `find` comes up empty,
    // covering the `if (slot)` else arm.
    node.meteorNext = 0

    for (const slot of node.meteorPool) {
      slot.active = true
      slot.t0 = 2
    }

    s.t = 2.1

    updateFx(s)

    expect(node.meteorNext).toBeGreaterThan(2)

    // Far future → all live flashes expire past SF_METEOR.LIFE (the
    // deactivation + material-opacity-reset arms).
    s.t = 1e6

    updateFx(s)

    expect(slotB.active).toBe(false)
  })

  test('updateFx swirls nebula depth layers and breathes pulse bodies', async () => {
    const { updateFx } = await import('../../../../engine/frame/fx.js')

    const setScalar = jest.fn()
    const scaleSet = jest.fn()

    // A living-nebula node: two stacked layer materials (primary +
    // counter-rotating echo) plus the aspect-locked base scale.
    const nebLayer = { material: { rotation: 0, opacity: 1 }, rate: 0.02, phase: 1.2, opBase: 1 }
    const nebEcho = {
      material: { rotation: 0, opacity: 0.22 },
      rate: -0.03,
      phase: 0.4,
      opBase: 0.22,
    }

    const s = {
      t: 2,
      nodes: new Map([
        [
          'nebula',
          {
            def: { radius: 5 },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: { set: scaleSet } },
            nebula: { layers: [nebLayer, nebEcho], baseScale: { x: 3, y: 2 }, phase: 0.7 },
          },
        ],
        [
          // Pulse + setScalar — the scale-oscillation arm.
          'pulsar',
          {
            def: { pulse: { period: 8, amp: 0.1 } },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: { setScalar } },
          },
        ],
        [
          // Pulse without setScalar — the optional-chain false arm.
          'dimvar',
          {
            def: { pulse: { period: 8, amp: 0.1 } },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: {} },
          },
        ],
      ]),
    }

    updateFx(s)

    // Every layer swirled by rate·t and shimmered within opBase bounds.
    expect(nebLayer.material.rotation).toBeCloseTo(1.2 + 2 * 0.02)
    expect(nebEcho.material.rotation).toBeCloseTo(0.4 + 2 * -0.03)
    expect(nebLayer.material.opacity).toBeGreaterThan(0)
    expect(nebEcho.material.opacity).toBeLessThanOrEqual(0.22)

    // Whole-sprite breathe wrote the aspect-locked scale back scaled.
    expect(scaleSet).toHaveBeenCalled()
    expect(setScalar).toHaveBeenCalled()
  })

  test('fillSpiral covers the barred bulge and the bubble resample paths', async () => {
    const { fillSpiral } = await import('../../../../engine/spiral.js')

    const count = 64
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)

    // count·BULGE ≥ 1 → the `inBulge` block rotates bar points; the
    // off-center exclusion bubble catches some arm points so the
    // keep-dim, resample-escape and outside arms all run.
    const bubble = { x: 30, y: 0, z: 0, r: 25 }

    fillSpiral(pos, col, 100, 7, count, 4, 1, 0.1, undefined, bubble)

    expect(Array.from(pos).some((v) => v !== 0)).toBe(true)
    expect(Array.from(col).some((v) => v !== 0)).toBe(true)
  })
})

describe('comet tail + plume fx tails', () => {
  test('updateFx drives comet particle tails by conic radius and cycles plume puffs', async () => {
    const { updateFx } = await import('../../../../engine/frame/fx.js')
    const { SF_USER_GAS } = await import('../../../../engine/bodies/comet.js')

    /**
     * Particle-layer fixture — a Points-shaped object whose
     * `userData.gasPts` carries real typed arrays so the sim loop
     * writes positions/colors for real. `ud` is exposed on the fixture
     * so assertions can read the buffers back.
     */
    const mkPts = () => {
      const n = 4

      const ud = {
        pos: new Float32Array(n * 3),
        col: new Float32Array(n * 3),
        aMat: { needsUpdate: false },
        aCol: { needsUpdate: false },
        phase: Float32Array.from({ length: n }, (_, i) => i / n),
        lat: Float32Array.from({ length: n }, () => 0.4),
        latZ: Float32Array.from({ length: n }, () => 0.2),
        rate: Float32Array.from({ length: n }, () => 0.1),
        wobP: Float32Array.from({ length: n }, () => 0.3),
        wobA: Float32Array.from({ length: n }, () => 0.5),
        wobF: Float32Array.from({ length: n }, () => 0.8),
        dim: Float32Array.from({ length: n }, () => 0.7),
        len: 6,
        spread: 0.7,
        grow: 2,
        rgb: [0.5, 0.7, 1],
        op: 0.5,
      }

      return {
        visible: true,
        material: { opacity: 0 },
        userData: { [SF_USER_GAS]: ud },
        ud,
      }
    }

    const mkComa = () => ({
      scale: { set: jest.fn() },
      material: { opacity: 0.4 },
    })

    /**
     * Instanced-tail surface — a live billboard path needs the tail's
     * `setMatrixAt`/`getWorldQuaternion` plus a camera quaternion and a
     * `s.THREE` scratch allocator. `sz` seeds the per-grain size array
     * on ion only, so ionGas still takes the `ud.sz?.[i] ?? 1` arm.
     */
    const mkInstanced = (withSizes) => {
      const pts = mkPts()

      pts.setMatrixAt = jest.fn()
      pts.getWorldQuaternion = (q) => q

      if (withSizes) pts.ud.sz = Float32Array.from({ length: 4 }, () => 0.8)

      return pts
    }

    const near = {
      ion: mkInstanced(true),
      ionGas: mkInstanced(false),
      dust: mkPts(),
      dustGas: mkPts(),
    }
    const far = { ion: mkPts(), ionGas: mkPts(), dust: mkPts(), dustGas: mkPts() }

    const jet = { material: { opacity: 0.4 } }
    const puff = {
      position: { set: jest.fn() },
      scale: { set: jest.fn() },
      material: { opacity: 0 },
    }

    /**
     * Minimal THREE scratch — fx.ts lazily builds _mat/_vec/_scl/_qN/_qC
     * once `s.THREE` exists; the billboard compose path only needs
     * compose/set/setScalar and a chainable invert/multiply.
     */
    const FXQuat = class {
      invert() {
        return this
      }

      multiply() {
        return this
      }
    }

    const s = {
      t: 1.5,
      // A camera carrying only `quaternion` — no getWorldQuaternion —
      // so camQ resolves through the `?? cam?.quaternion` fallback arm.
      camera: { quaternion: new FXQuat() },
      THREE: {
        Matrix4: class {
          compose() {}
        },
        Vector3: class {
          set() {}

          setScalar() {}
        },
        Quaternion: FXQuat,
      },
      nodes: new Map([
        [
          // Periapsis — center.position.x = rMin → full-length tails.
          'comet-near',
          {
            def: { radius: 0.4 },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: {} },
            center: { position: { x: 30 } },
            comet: {
              ...near,
              coma: mkComa(),
              rMin: 30,
              rMax: 330,
              comaScale: { x: 3, y: 3 },
            },
          },
        ],
        [
          // Apoapsis — the periapsis window is shut (r > rCut): tails
          // unmount (`visible=false`) and the coma drops to its floor.
          'comet-far',
          {
            def: { radius: 0.4 },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: {} },
            center: { position: { x: 330 } },
            comet: {
              ...far,
              coma: mkComa(),
              rMin: 30,
              rMax: 330,
              comaScale: { x: 3, y: 3 },
            },
          },
        ],
        [
          // Broken/sparse gas records — every fallback arm:
          //   ion     — no userData at all (ud undefined → early return)
          //   ionGas  — ud present, `pos` missing → `!ud.pos` return
          //   dust    — `pos` present, `col` missing → `!ud.col` return
          //   dustGas — `phase` missing → `n ?? 0` → `!n` return
          //   coma    — material-less → `coma.material?.opacity` false arm
          'comet-bare',
          {
            def: { radius: 0.3 },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: {} },
            center: { position: { x: 100 } },
            comet: {
              ion: { visible: true },
              ionGas: {
                visible: true,
                userData: { [SF_USER_GAS]: { col: new Float32Array(3), phase: [0] } },
              },
              dust: {
                visible: true,
                userData: { [SF_USER_GAS]: { pos: new Float32Array(3) } },
              },
              dustGas: {
                visible: true,
                userData: { [SF_USER_GAS]: { pos: new Float32Array(3), col: new Float32Array(3) } },
              },
              coma: { scale: { set: () => {} } },
              rMin: 30,
              rMax: 330,
              comaScale: { x: 3, y: 3 },
            },
          },
        ],
        [
          // Circular orbit — rMin == rMax → the span-0 `f = 1` arm, plus
          // a SPARSE sim record: only pos/col/phase exist, so every
          // `?? 0` / `?? 1` / `?? [1,1,1]` fallback fires inside the
          // grain loop, aPos/aCol flags are skipped, and `ud.op ?? 1`
          // feeds the material opacity. `phase` carries a hole so the
          // per-grain `ud.phase?.[i] ?? 0` fallback fires too; dustGas
          // carries a record but NO material → the `p.material?.opacity`
          // false arm.
          'comet-flat',
          {
            def: { radius: 0.3 },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: {} },
            comet: {
              ion: {
                visible: true,
                material: { opacity: 0.9 },
                userData: {
                  [SF_USER_GAS]: {
                    pos: new Float32Array(3),
                    col: new Float32Array(3),
                    phase: [undefined],
                  },
                },
              },
              ionGas: mkPts(),
              dust: mkPts(),
              dustGas: {
                visible: true,
                userData: {
                  [SF_USER_GAS]: {
                    pos: new Float32Array(3),
                    col: new Float32Array(3),
                    phase: new Float32Array([0.5]),
                  },
                },
              },
              coma: mkComa(),
              rMin: 60,
              rMax: 60,
              comaScale: { x: 2, y: 2 },
            },
          },
        ],
        [
          // Plumed moon — the puff cycle + jet shimmer arms.
          'plumed',
          {
            def: { radius: 0.5 },
            pivot: { rotation: { y: 0 } },
            spinner: { rotation: { y: 0 } },
            satPivots: [],
            mesh: { scale: {} },
            plumes: [
              {
                jet,
                puff,
                dir: { x: 0, y: -1, z: 0 },
                // Day-side vent — sun straight down the vent axis →
                // the `dot(dir,sunDir)` lit arm stays at full strength.
                sunDir: { x: 0, y: -1, z: 0 },
                phase: 0.25,
                rate: 0.3,
                radius: 0.5,
                height: 1.2,
                width: 0.1,
              },
              // Material-less sprites — `?.opacity` false arms.
              {
                jet: {},
                puff: {
                  position: { set: () => {} },
                  scale: { set: () => {} },
                },
                dir: { x: 1, y: 0, z: 0 },
                phase: 0,
                rate: 0.2,
                radius: 0.5,
                height: 1,
                width: 0.1,
              },
            ],
          },
        ],
      ]),
    }

    updateFx(s)

    // Periapsis — grains streamed along +x (x = d·len grows with each
    // grain's age), colors lit by the envelope, buffers flagged for
    // upload, material opacity = stored base × f (=1 at rMin).
    const ionUd = near.ion.ud

    expect(Array.from(ionUd.pos).some((v) => v > 0)).toBe(true)
    expect(Array.from(ionUd.col).some((v) => v > 0)).toBe(true)
    expect(ionUd.aMat.needsUpdate).toBe(true)
    expect(ionUd.aCol.needsUpdate).toBe(true)
    // phase = i/4, t·rate = 0.15 → grain 1 sits at d = 0.4 → x = 0.4·6.
    expect(ionUd.pos[3]).toBeCloseTo(0.4 * 6)
    expect(near.ion.material.opacity).toBeCloseTo(0.5)
    expect(near.ion.visible).toBe(true)

    // Instanced billboard — per-grain quad matrices composed for the
    // tails that carry `setMatrixAt`/`getWorldQuaternion` under a live
    // camera; the plain Points-shaped tails skip the compose block.
    expect(near.ion.setMatrixAt).toHaveBeenCalled()
    expect(near.ionGas.setMatrixAt).toHaveBeenCalled()

    // Apoapsis — outside the periapsis window the tails switch off
    // entirely (a comet flying home carries no streak, only the coma
    // floor) and the sim is skipped (buffers untouched).
    expect(far.ion.visible).toBe(false)
    expect(Array.from(far.ion.ud.pos).every((v) => v === 0)).toBe(true)

    // Plume — puff rose along -y and faded mid-rise; jet shimmered.
    expect(puff.position.set).toHaveBeenCalled()
    expect(puff.scale.set).toHaveBeenCalled()
    expect(jet.material.opacity).toBeGreaterThan(0)
  })
})
