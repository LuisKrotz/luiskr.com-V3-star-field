/**
 * @file coverage/starfield/engine/starfield-frame-cloud-tails.test.js
 * @description Coverage tails for the per-frame update layer and the
 * async fill/decode paths — `updateLod`'s reveal arm + detail loop,
 * `updateStructures`, `updateGalaxyClouds`, `updateStarCloud`, the
 * `ensureStarCloud` fetch→decode→mount chain, `makeSpiralGalaxy`'s
 * mobile/volumetric split, `makeBelt`'s worker/null applies and
 * `makeStructure`'s single-knot filament arm.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { SF_KINDS, SF_GROUPS } from '@core/tokens/starfield/kinds.js'
import { SF_BODY_IDS, SF_LOD, SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'

jest.unstable_mockModule('@core/utils/wasm/wasm-pool.js', () => ({
  wasmPool: { dispatch: jest.fn(() => Promise.resolve(null)) },
}))

const { createStarState } = await import('../../../../engine/state.js')
const { tickStar } = await import('../../../../engine/frame.js')
const { ensureStarCloud, disposeStarCloud } = await import('../../../../engine/star-cloud.js')
const { makeSpiralGalaxy } = await import('../../../../engine/spiral.js')
const { makeBelt } = await import('../../../../engine/bodies/belt.js')
const { makeStructure } = await import('../../../../engine/bodies/structures.js')
const { buildStarBodies } = await import('../../../../engine/bodies-scene.js')
const { seedFrom, lcg } = await import('../../../../engine/rand.js')
const { wasmPool } = await import('@core/utils/wasm/wasm-pool.js')
const THREE = await import('three')
const { MeshBasicNodeMaterial } = await import('three/webgpu')
const TSL = await import('three/tsl')

const NODE_DEPS = { TSL, mats: { MeshBasicNodeMaterial } }

const dispatch = wasmPool.dispatch

const makeCanvas = () => document.createElement('canvas')

const makeState = (overrides = {}) => Object.assign(createStarState(makeCanvas()), overrides)

const fakeCamera = () => ({
  position: { x: 0, y: 0, z: 0, set: jest.fn() },
  aspect: 1,
  updateProjectionMatrix: jest.fn(),
})

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  dispatch.mockReset().mockImplementation(() => Promise.resolve(null))
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
})

afterEach(() => {
  window.requestAnimationFrame.mockRestore?.()
  delete globalThis.fetch
})

describe('tickStar per-frame update tails', () => {
  const mk = (def, extra = {}) => ({
    def: { radius: 1, ...def },
    pivot: { rotation: { y: 0 }, visible: false },
    spinner: { rotation: { y: 0 } },
    mesh: {},
    satPivots: [],
    ...extra,
  })

  test('updateLod reveal arm + detail toggling', () => {
    const s = makeState({
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
      scene: {},
      controls: { update: jest.fn() },
    })

    const detailObj = { visible: false }

    s.nodes.set('inner', mk({ kind: SF_KINDS.STAR }, { detail: [detailObj] }))

    tickStar(s, 1000)

    expect(s.nodes.get('inner').pivot.visible).toBe(true)
    expect(detailObj.visible).toBe(true)
  })

  test('updateLod collapses the solar tier to the Sun far-glyph past SOLAR_FAR', () => {
    const cam = fakeCamera()

    cam.position.x = SF_LOD.SOLAR_FAR + 1

    const s = makeState({
      camera: cam,
      renderer: { render: jest.fn() },
      scene: {},
      controls: { update: jest.fn() },
    })

    const farGlow = { visible: false }

    const farPick = { visible: false }

    const sunMesh = { visible: true }

    // Solar star → keeps its pivot but swaps sphere for the far glyph.
    s.nodes.set(
      'sun',
      mk({ kind: SF_KINDS.STAR, group: SF_GROUPS.SOLAR }, { mesh: sunMesh, farGlow, farPick })
    )

    // Far glyph without a far-pick proxy — the `if (node.farPick)`
    // else arms on both the collapse and restore paths.
    const bareGlow = { visible: false }

    const bareMesh = { visible: true }

    s.nodes.set(
      'sun-bare',
      mk({ kind: SF_KINDS.STAR, group: SF_GROUPS.SOLAR }, { mesh: bareMesh, farGlow: bareGlow })
    )

    // Solar planet without a far glyph → whole pivot hides.
    s.nodes.set('earth', mk({ kind: SF_KINDS.PLANET, group: SF_GROUPS.SOLAR }))

    // Galactic star — the solar gate must not touch it, and its
    // farGlyph stays live while the camera is beyond its near radius
    // (the point glow is the star's far-field face).
    const vegaGlyph = { visible: true }

    const vegaDetail = { visible: false }

    s.nodes.set(
      'vega',
      mk(
        { kind: SF_KINDS.STAR, group: SF_GROUPS.MILKY_WAY },
        { farGlyph: vegaGlyph, detail: [vegaDetail] }
      )
    )

    tickStar(s, 1000)

    const sun = s.nodes.get('sun')

    expect(sun.pivot.visible).toBe(true)
    expect(sunMesh.visible).toBe(false)
    expect(farGlow.visible).toBe(true)
    expect(farPick.visible).toBe(true)
    expect(bareMesh.visible).toBe(false)
    expect(bareGlow.visible).toBe(true)
    expect(s.nodes.get('earth').pivot.visible).toBe(false)
    expect(s.nodes.get('vega').pivot.visible).toBe(true)
    expect(vegaGlyph.visible).toBe(true)
    expect(vegaDetail.visible).toBe(false)

    // Back inside the tier → the sphere returns, the glyph retires;
    // the camera lands inside Vega's near radius so the photosphere
    // group swaps in and the point glyph stands down.
    cam.position.x = 0

    tickStar(s, 1001)

    expect(sun.pivot.visible).toBe(true)
    expect(sunMesh.visible).toBe(true)
    expect(farGlow.visible).toBe(false)
    expect(farPick.visible).toBe(false)
    expect(bareMesh.visible).toBe(true)
    expect(bareGlow.visible).toBe(false)
    expect(s.nodes.get('earth').pivot.visible).toBe(true)
    expect(vegaGlyph.visible).toBe(false)
    expect(vegaDetail.visible).toBe(true)
  })

  test('updateStructures writes the shell fade uniform and speckle opacity', () => {
    const s = makeState({
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
      scene: {},
      controls: { update: jest.fn() },
    })

    const fade = { value: -1 }

    const speckleMat = { opacity: -1 }

    s.nodes.set(
      'bubble',
      mk(
        { kind: SF_KINDS.STRUCTURE, structure: { radius: 10 } },
        { mesh: { userData: { fade, speckleMat } } }
      )
    )
    // Non-structure node → the `kind !== structure` continue arm.
    s.nodes.set('plain', mk({ kind: SF_KINDS.STAR }))
    // Structure without `structure` def or userData slots → the
    // `?? node.def.radius` fallback and the no-fade/no-speckle arms.
    s.nodes.set('bare', mk({ kind: SF_KINDS.STRUCTURE, radius: 6 }))

    tickStar(s, 1000)

    expect(s.failed).toBe(false)
    expect(fade.value).toBeGreaterThanOrEqual(0)
    expect(speckleMat.opacity).toBeGreaterThan(0)
  })

  test('updateGalaxyClouds drives the volumetric material fade + size floor', () => {
    const s = makeState({
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
      scene: {},
      controls: { update: jest.fn() },
    })

    Object.defineProperty(s.canvas, 'clientHeight', { value: 500, configurable: true })

    const mat = { opacity: 0, size: 0 }

    s.nodes.set(
      'mw',
      mk(
        { kind: SF_KINDS.GALAXY, radius: 520, spiralDisc: { volumetric: true } },
        {
          mesh: {
            children: [{ userData: { volumetric: true }, material: mat }, { userData: {} }],
          },
        }
      )
    )

    // Camera far outside the disc → far-gain opacity + px floor.
    s.camera.position.x = 5000

    tickStar(s, 1000)

    expect(mat.opacity).toBeGreaterThan(0)
    expect(mat.size).toBeGreaterThan(0)

    // No-material points → `points?.material` false arm.
    const matless = { children: [{ userData: { volumetric: true } }] }

    s.nodes.get('mw').mesh = matless
    tickStar(s, 2000)
  })

  test('updateStarCloud fades the cloud by camera distance', () => {
    const s = makeState({
      camera: fakeCamera(),
      renderer: { render: jest.fn() },
      scene: {},
      controls: { update: jest.fn() },
    })

    const mat = { opacity: -1 }

    s.starCloud = {
      matrixWorld: { elements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9e9, 0, 0, 0] },
      material: mat,
    }

    tickStar(s, 1000)

    expect(mat.opacity).toBeGreaterThanOrEqual(0)

    // Missing matrixWorld → `e?.[n] ?? 0` fallback arms.
    s.starCloud = { material: mat }

    tickStar(s, 2000)

    // Cloud without a material → `mat?.opacity != null` else arm.
    s.starCloud = { matrixWorld: { elements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }

    tickStar(s, 3000)
  })

  test('camera-less state no-ops every per-frame updater', () => {
    const s = makeState({ camera: null })

    s.nodes.set('bubble', mk({ kind: SF_KINDS.STRUCTURE, structure: { radius: 4 } }))

    tickStar(s, 1000)
  })
})

describe('ensureStarCloud tails', () => {
  /**
   * Packs a valid deep-field binary: uint32 count + count×6 f32
   * (x,y,z,mag,ci,kind). One record per kind plus a 100-kpc sentinel
   * star so the drop arm runs, plus a far-edge star for the fade band.
   */
  const makeBin = (records) => {
    const buf = new ArrayBuffer(4 + records.length * SF_STAR_CLOUD.STRIDE * 4)

    new DataView(buf).setUint32(0, records.length, true)

    const f32 = new Float32Array(buf, 4)

    records.forEach((r, i) => f32.set(r, i * SF_STAR_CLOUD.STRIDE))

    return buf
  }

  const RECORDS = [
    [10, 5, -8, 2.5, 0.6, SF_STAR_CLOUD.KIND_STAR],
    [2000, 0, 0, 7, 0.1, SF_STAR_CLOUD.KIND_STAR],
    [60000, 0, 0, 3, 0.2, SF_STAR_CLOUD.KIND_STAR], // sentinel — dropped
    [30, 10, 5, 4, 0, SF_STAR_CLOUD.KIND_EXOPLANET],
    [900, -20, 40, 8, 0, SF_STAR_CLOUD.KIND_DSO],
  ]

  const fetchOk = (buf) => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) })
    )
  }

  const sunNode = () => {
    const added = []

    return { added, node: { def: {}, pivot: { add: (o) => added.push(o) } } }
  }

  test('decodes the binary, builds the cloud and mounts it on the Sun pivot', async () => {
    const s = makeState()

    const { node, added } = sunNode()

    s.nodes.set(SF_BODY_IDS.SUN, node)
    s.nodes.set(SF_BODY_IDS.MILKY_WAY, { def: { tilt: 0.35 }, pivot: {}, mesh: {} })

    fetchOk(makeBin(RECORDS))

    ensureStarCloud(s, THREE)

    expect(s.starCloudLoading).toBe(true)
    // Repeat call → the loading/disposed guards no-op.
    ensureStarCloud(s, THREE)

    await flush()
    await flush()

    expect(s.starCloud).toBeTruthy()
    expect(added.length).toBe(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(`${SF_DATA_BASE}/${SF_STAR_CLOUD.FILE}`)
  })

  test('worker result buffers mount identically to the local decode', async () => {
    const s = makeState()

    const { node } = sunNode()

    s.nodes.set(SF_BODY_IDS.SUN, node)

    fetchOk(makeBin(RECORDS))

    const n = RECORDS.length * 3

    dispatch.mockImplementation(() =>
      Promise.resolve({ results: { pos: new Float32Array(n), col: new Float32Array(n) } })
    )

    ensureStarCloud(s, THREE)
    await flush()
    await flush()

    expect(s.starCloud).toBeTruthy()

    disposeStarCloud(s)
    expect(s.starCloud).toBeNull()
  })

  test('mount covers the no-sun/no-mw arms', async () => {
    // Sun present, MW absent → `mw?.def.tilt ?? 0` fallback.
    const s = makeState()

    const { node, added } = sunNode()

    s.nodes.set(SF_BODY_IDS.SUN, node)
    fetchOk(makeBin(RECORDS))
    ensureStarCloud(s, THREE)
    await flush()
    await flush()

    expect(added.length).toBe(1)

    // Sun absent → the `if (sun)` else arm — cloud still registers.
    const s2 = makeState()

    fetchOk(makeBin(RECORDS))
    ensureStarCloud(s2, THREE)
    await flush()
    await flush()

    expect(s2.starCloud).toBeTruthy()
  })

  test('failed fetch, bad headers and disposed state bail out', async () => {
    // !res.ok arm
    const s = makeState()

    globalThis.fetch = jest.fn(() => Promise.resolve({ ok: false }))

    ensureStarCloud(s, THREE)
    await flush()
    expect(s.starCloud).toBeNull()

    // Header claims more records than the buffer holds → length guard.
    const tiny = new ArrayBuffer(8)

    new DataView(tiny).setUint32(0, 99, true)
    fetchOk(tiny)
    ensureStarCloud(makeState(), THREE)
    await flush()

    // Disposed mid-decode → the post-fill `if (s.disposed) return` arm:
    // the flag flips inside dispatch, between the early `!buf ||` guard
    // and the mount check.
    const s2 = makeState()

    fetchOk(makeBin(RECORDS))
    dispatch.mockImplementation(() => {
      s2.disposed = true
      return Promise.resolve(null)
    })
    ensureStarCloud(s2, THREE)
    await flush()
    await flush()
    expect(s2.starCloud).toBeNull()

    // Disposed before the fetch resolves → the `!buf || s.disposed` arm.
    const s3 = makeState()

    fetchOk(makeBin(RECORDS))
    ensureStarCloud(s3, THREE)
    s3.disposed = true
    await flush()
    await flush()
    expect(s3.starCloud).toBeNull()
  })
})

describe('particle maker tails', () => {
  test('makeSpiralGalaxy covers mobile, volumetric and flat disc fills', async () => {
    const vol = {
      id: 'gx-vol',
      radius: 520,
      spin: 0.3,
      spiralDisc: { count: 8000, volumetric: true, thick: 1.8, halo: 0.05, bubble: 80 },
    }

    const m1 = makeSpiralGalaxy(THREE, vol, undefined, undefined, true)

    expect(m1.rotor).toBeTruthy()

    const m2 = makeSpiralGalaxy(THREE, vol, undefined, undefined, false)

    expect(m2.points).toBeTruthy()

    // Non-volumetric → `: count` arm; no photo → procedural sparkle.
    const flat = { id: 'gx-flat', radius: 30, spiralDisc: { count: 500 } }

    makeSpiralGalaxy(THREE, flat, undefined, undefined, false)

    // No `mobile` arg → default parameter arm; no `spiralDisc` → the
    // `?? SF_SPIRAL.COUNT`/`?? SF_SPIRAL.ARMS` fallback arms.
    makeSpiralGalaxy(THREE, { id: 'gx-bare', radius: 20 }, undefined, undefined)

    // Photo-textured non-volumetric disc → `if (photoTex)` +
    // `SPARKLE_FRAC` arms (`texture` resolves through the map).
    const photoTex = { image: { naturalWidth: 400, naturalHeight: 200 }, colorSpace: '' }

    makeSpiralGalaxy(
      THREE,
      { id: 'gx-photo', radius: 30, texture: '/gx.jpg', spiralDisc: { count: 500 } },
      new Map([['/gx.jpg', photoTex]]),
      undefined,
      false
    )

    // Volumetric without `spin` → `spinCut2 = 0` arm (no rotor split).
    makeSpiralGalaxy(
      THREE,
      { id: 'gx-vol-calm', radius: 40, spiralDisc: { count: 200, volumetric: true } },
      undefined,
      undefined,
      false
    )

    // Worker-resolved buffers apply through the `if (res)` arm — both
    // the sparkle fill and the dust fill resolve from the pool. Each
    // chunk must return exactly (i1−i0)·3 floats or fillField voids it.
    dispatch.mockImplementation((action, payload) =>
      Promise.resolve({
        results: {
          pos: new Float32Array((payload.i1 - payload.i0) * 3),
          col: new Float32Array((payload.i1 - payload.i0) * 3),
        },
      })
    )

    makeSpiralGalaxy(THREE, flat, undefined, undefined, false)
    makeSpiralGalaxy(THREE, vol, undefined, undefined, false)

    // Elliptical dwarf → the third fill site's `if (res)` arm.
    makeSpiralGalaxy(
      THREE,
      { id: 'gx-ell', radius: 18, spiralDisc: { count: 200, elliptical: true } },
      undefined,
      undefined,
      false
    )

    await flush()

    // Post-fill: attributes resolved through the worker-null fallback.
    expect(m1.points.geometry.getAttribute('position')).toBeTruthy()
  })

  test('makeBelt applies worker results and local fills after flush', async () => {
    const def = {
      id: 'belt-x',
      color: 0x334455,
      belt: { inner: 2, outer: 5, count: 64, puff: 0.2, gapFreq: 2 },
    }

    dispatch.mockImplementation(() =>
      Promise.resolve({
        results: { pos: new Float32Array(192), col: new Float32Array(192), kept: 64 },
      })
    )

    makeBelt(THREE, def, undefined)
    await flush()

    dispatch.mockImplementation(() => Promise.resolve(null))
    makeBelt(THREE, def, undefined)
    await flush()
  })

  test('makeStructure covers the single-knot filament arm', async () => {
    // Find a seeded id whose knot draw (3rd lcg call) lands knots = 1 —
    // only then does the `Math.max(knots - 1, 1)` divisor floor run.
    let id = 'st-0'

    for (let i = 0; i < 200; i++) {
      const cand = `st-${i}`

      const r = lcg(seedFrom(cand))

      r()
      r()

      if (1 + Math.floor(r() * 3) === 1) {
        id = cand
        break
      }
    }

    const grp = makeStructure(THREE, NODE_DEPS, {
      id,
      radius: 4,
      structure: { radius: 3, speckles: 8 },
    })

    expect(grp.userData.speckleMat).toBeTruthy()

    // Worker-resolved buffers → the `if (!res)` else arm + `res ?`
    // position/color arms.
    dispatch.mockImplementation((action, payload) =>
      Promise.resolve({
        results: {
          pos: new Float32Array(payload.count * 3),
          col: new Float32Array(payload.count * 3),
        },
      })
    )

    makeStructure(THREE, NODE_DEPS, { id, radius: 4, structure: { radius: 3, speckles: 8 } })
    await flush()
  })

  test('buildStarBodies covers the cluster/rider/color fallback arms', () => {
    const s = makeState()

    const defs = [
      {
        id: 'cl',
        name: 'Cluster',
        kind: SF_KINDS.CLUSTER,
        group: 'nebulae',
        radius: 3,
        pos: [5, 0, 0],
      },
      // Milky Way without `tilt` → `mw.def.tilt ?? 0` in the rider.
      {
        id: SF_BODY_IDS.MILKY_WAY,
        name: 'Milky Way',
        kind: SF_KINDS.GALAXY,
        group: 'galaxies',
        radius: 520,
        pos: [-267, 0, 0],
        spiralDisc: { count: 64 },
      },
      // Unparented body with `orbit` but no `pos` → `def.pos?.[n] ?? 0`
      // + `def.phase ?? 0` arms inside mountGalacticRider.
      {
        id: 'free-orbit',
        name: 'Free',
        kind: SF_KINDS.PLANET,
        group: 'planets',
        radius: 5,
        orbit: 10,
      },
      // Star without `color` → `def.color ?? SF_COLORS.SUN_LIGHT` in
      // the corona sprite material.
      {
        id: 'plain-star',
        name: 'Plain',
        kind: SF_KINDS.STAR,
        group: 'stars',
        radius: 2,
        pos: [1, 0, 0],
      },
    ]

    buildStarBodies(s, THREE, NODE_DEPS, defs, new Map(), undefined)

    expect(s.nodes.size).toBe(defs.length)
  })
})
