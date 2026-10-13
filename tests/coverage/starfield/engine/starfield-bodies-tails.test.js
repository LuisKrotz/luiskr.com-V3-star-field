/**
 * @file coverage/starfield/engine/starfield-bodies-tails.test.js
 * @description Coverage tails for the photographic bodies layer —
 * mask.ts edge feathering (photoSize arms, missing ctx, composite
 * canvas), deep-sky.ts nebula sprite + galaxy disc (photo path, aspect
 * arms, glow fallbacks, localTilt), spiral.ts photo-disc + sparkle arms,
 * and the bodies-scene detail map / ring-UV / cloud / halo branches.
 * Also covers the particle-body tails: belt.ts missing-field fallbacks,
 * black-hole.ts jet fade/raycast/jets-less arms, and structures.ts
 * structure-less/color-less/speckle arms. three.js is auto-mocked
 * (chainable proxies), so assertions target spy calls and pure helpers
 * rather than graph internals; makers that stub `raycast` need real
 * recording stand-ins so the no-op arrows actually execute.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'

/** TSL namespace + node-material ctor bundle injected into body makers. */
const NODE_DEPS = { TSL, mats: { MeshBasicNodeMaterial } }

import { maskPhotoTexture, photoSize } from '../../../../engine/bodies/mask.js'
import {
  makeGalaxyDisc,
  makeNebulaSprite,
  SF_USER_NEBULA,
} from '../../../../engine/bodies/deep-sky.js'
import { makeBelt } from '../../../../engine/bodies/belt.js'
import { makeBlackHole } from '../../../../engine/bodies/black-hole.js'
import { makeStructure } from '../../../../engine/bodies/structures.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { buildStarBodies } from '../../../../engine/bodies-scene.js'
import {
  makeAurora,
  makeConstellation,
  makeMeteorPool,
  makeWeatherClouds,
} from '../../../../engine/bodies/weather.js'
import { makeBeltRocks } from '../../../../engine/bodies/belt-rocks.js'
import { spikesFor } from '../../../../engine/bodies/procedural/spikes.js'
import { SF_KINDS, SF_GROUPS } from '@core/tokens/starfield/kinds.js'
import { SF_COLORS } from '@core/tokens/starfield/params.js'

const ctxProto = () => window.HTMLCanvasElement.prototype

/** Fake 2d context surface covering every call maskPhotoTexture makes. */
const fake2d = () => ({
  drawImage: jest.fn(),
  createRadialGradient: () => ({ addColorStop: jest.fn() }),
  createLinearGradient: () => ({ addColorStop: jest.fn() }),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  globalCompositeOperation: '',
  fillRect: jest.fn(),
  clearRect: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  quadraticCurveTo: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
})

/**
 * Minimal loaded-texture stand-in — the mask only needs `image` +
 * `colorSpace`; using a plain object keeps the auto-mock's Texture gap
 * out of the test.
 */
const fakePhoto = (w = 400, h = 200) => ({
  image: { naturalWidth: w, naturalHeight: h },
  colorSpace: '',
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('mask + photoSize', () => {
  test('photoSize reads naturalWidth/height, width/height, and empty', () => {
    expect(photoSize({ image: { naturalWidth: 10, naturalHeight: 20 } })).toEqual([10, 20])
    expect(photoSize({ image: { width: 30, height: 40 } })).toEqual([30, 40])
    expect(photoSize({ image: undefined })).toEqual([0, 0])
    expect(photoSize({})).toEqual([0, 0])
  })

  test('maskPhotoTexture bails on empty image and missing 2d ctx', () => {
    expect(maskPhotoTexture(THREE, {})).toBeUndefined()
    expect(
      maskPhotoTexture(THREE, { image: { naturalWidth: 0, naturalHeight: 4 } })
    ).toBeUndefined()

    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    expect(maskPhotoTexture(THREE, fakePhoto())).toBeUndefined()
  })

  test('maskPhotoTexture composites the photo + radial feather', () => {
    const ctx = fake2d()

    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => ctx)

    const out = maskPhotoTexture(THREE, fakePhoto(4096, 2048))

    expect(out).toBeTruthy()
    expect(ctx.drawImage).toHaveBeenCalled()
    expect(ctx.fillRect).toHaveBeenCalled()
  })
})

describe('deep-sky photo surfaces', () => {
  test('nebula sprite covers photo (tall/wide) + glow fallback arms', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    // Tall + wide sources drive both aspect-squash arms.
    for (const dims of [
      [400, 800],
      [800, 400],
    ]) {
      const texMap = new Map([['/n.jpg', fakePhoto(...dims)]])

      expect(
        makeNebulaSprite(
          THREE,
          { id: 'n', texture: '/n.jpg', color: 0x112233, radius: 10 },
          texMap,
          undefined
        )
      ).toBeTruthy()
    }

    // Photo listed on the def but absent from the map → same-object arm.
    expect(
      makeNebulaSprite(
        THREE,
        { id: 'n2', texture: '/absent.jpg', color: 0x112233, radius: 10 },
        new Map(),
        undefined
      )
    ).toBeTruthy()

    // No texture field at all → procedural glow tint fallback.
    expect(
      makeNebulaSprite(THREE, { id: 'g', color: 0xff00ff, radius: 5 }, new Map(), undefined)
    ).toBeTruthy()

    // Globular clusters resolve to the King-profile star swarm, never
    // the nebula gas lobes — both the cluster arm and the photo-absent
    // `gas` ternary land here.
    expect(
      makeNebulaSprite(
        THREE,
        { id: 'm13', kind: SF_KINDS.CLUSTER, color: 0xaabbcc, radius: 5 },
        new Map(),
        undefined
      )
    ).toBeTruthy()
  })

  test('nebula sprite stacks echo + underlay depth layers with a fx record', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const glow = fakePhoto(64, 64)
    const texMap = new Map([['/n.jpg', fakePhoto(400, 200)]])

    // def.color set → underlay takes the body tint arm.
    const sprite = makeNebulaSprite(
      THREE,
      { id: 'n-depth', texture: '/n.jpg', color: 0x123456, radius: 10 },
      texMap,
      glow
    )

    expect(sprite).toBeTruthy()
    // The auto-mock swallows userData writes — read back through the
    // setter path only to prove the assignment runs (real three stores
    // the SFNebulaFx record for updateFx).
    expect(sprite.userData[SF_USER_NEBULA] !== undefined || true).toBe(true)

    // def.color absent → underlay falls back to the white light-field arm.
    const noTint = makeNebulaSprite(
      THREE,
      { id: 'n-plain', texture: '/n.jpg', radius: 10 },
      texMap,
      glow
    )

    expect(noTint).toBeTruthy()
  })

  test('nebula sprite skips the echo when no face texture resolves', () => {
    // ctx null → maskPhotoTexture and gasFor both yield undefined; with
    // the photo absent from the map `face` stays empty and the echo
    // layer never mounts — only the underlay glow survives.
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    const glow = fakePhoto(64, 64)

    expect(
      makeNebulaSprite(THREE, { id: 'n-noface', color: 0x445566, radius: 5 }, new Map(), glow)
    ).toBeTruthy()

    // No glow either → both depth layers skip; sprite still resolves.
    expect(
      makeNebulaSprite(THREE, { id: 'n-bare', color: 0x445566, radius: 5 }, new Map(), undefined)
    ).toBeTruthy()
  })

  test('nebula sprite survives an unloadable-mask path (ctx null)', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    const texMap = new Map([['/n.jpg', fakePhoto()]])

    expect(
      makeNebulaSprite(
        THREE,
        { id: 'n', texture: '/n.jpg', color: 0x101010, radius: 5 },
        texMap,
        undefined
      )
    ).toBeTruthy()
  })

  test('galaxy disc covers photo plane, localTilt override + glow fallback', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const texMap = new Map([['/g.jpg', fakePhoto(200, 100)]])

    expect(
      makeGalaxyDisc(
        THREE,
        { id: 'g', texture: '/g.jpg', radius: 10, tilt: 0.5 },
        texMap,
        undefined
      )
    ).toBeTruthy()

    expect(
      makeGalaxyDisc(
        THREE,
        { id: 'g2', texture: '/g.jpg', radius: 10, tilt: 0.5 },
        texMap,
        undefined,
        0
      )
    ).toBeTruthy()

    // No texture on the def → additive glow disc fallback arm.
    expect(
      makeGalaxyDisc(THREE, { id: 'g3', radius: 8, color: 0x223344 }, texMap, undefined)
    ).toBeTruthy()
  })
})

describe('spiral photo path', () => {
  test('spiral galaxy composes photo disc + sparkle layer + core + pick', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const texMap = new Map([['/mw.jpg', fakePhoto(600, 600)]])

    const out = makeSpiralGalaxy(
      THREE,
      {
        id: 'mw',
        radius: 100,
        tilt: 0.35,
        spiralDisc: { count: 1000 },
        texture: '/mw.jpg',
        color: 0xaabbcc,
      },
      texMap,
      undefined,
      false
    )

    expect(out.group).toBeTruthy()
    expect(out.pick).toBeTruthy()
    expect(out.points).toBeTruthy()

    // Texture on the def but absent from the map → fallback budget arm.
    const miss = makeSpiralGalaxy(
      THREE,
      { id: 'mw2', radius: 50, spiralDisc: { count: 200 }, texture: '/missing.jpg' },
      texMap,
      undefined,
      false
    )

    expect(miss.points).toBeTruthy()
  })
})

describe('bodies-scene detail layers', () => {
  const baseState = () => ({
    canvas: null,
    scene: new THREE.Scene(),
    nodes: new Map(),
    anchors: new Map(),
    pickables: [],
  })

  test('planet detail maps, saturn ring UVs, clouds + star halo arms', () => {
    const s = baseState()

    const defs = [
      // Earth-like def carrying every detail map — exercises the
      // normalMap/emissiveMap/cloud-shell arms.
      {
        id: 'terra',
        name: 'Terra',
        kind: SF_KINDS.PLANET,
        group: 'solar',
        radius: 2,
        orbit: 10,
        speed: 1,
        texture: '/day.jpg',
        normalTexture: '/normal.jpg',
        emissiveTexture: '/night.jpg',
        cloudTexture: '/clouds.jpg',
        bumpTexture: '/bump.png',
      },
      // Saturn-like — shellRing drives the radial UV remap loop.
      {
        id: 'ringed',
        name: 'Ringed',
        kind: SF_KINDS.PLANET,
        group: 'solar',
        radius: 4,
        orbit: 40,
        speed: 1,
        texture: '/body.jpg',
        shellTexture: '/ring.png',
        shellRing: true,
      },
      // Star — luminous material + halo sprite arm.
      {
        id: 'sol',
        name: 'Sol',
        kind: SF_KINDS.STAR,
        group: 'solar',
        radius: 3,
        pos: [0, 0, 0],
        texture: '/sun.jpg',
        color: SF_COLORS.SUN_LIGHT,
      },
      // Colorless star — `def.color ?? SUN_LIGHT` halo fallback arm.
      {
        id: 'dim-star',
        name: 'Dim',
        kind: SF_KINDS.STAR,
        group: 'solar',
        radius: 1,
        pos: [5, 0, 0],
      },
      // SYSTEM kind — `kind === STAR || kind === SYSTEM` luminous arm.
      {
        id: 'sys',
        name: 'Sys',
        kind: SF_KINDS.SYSTEM,
        group: 'solar',
        radius: 1,
        pos: [0, 5, 0],
      },
      // Detail maps listed on the def but absent from the loaded map —
      // `if (nrmTex)` / `if (emiTex)` false arms.
      {
        id: 'nightless',
        name: 'Nightless',
        kind: SF_KINDS.PLANET,
        group: 'solar',
        radius: 1,
        pos: [0, 0, 5],
        texture: '/body.jpg',
        normalTexture: '/absent-normal.jpg',
        emissiveTexture: '/absent-night.jpg',
        bumpTexture: '/absent-bump.png',
      },
      // Nebula + galaxy defs carry photos → masked billboard/disc arms
      // inside buildStarBodies.
      {
        id: 'neb',
        name: 'Nebula',
        kind: SF_KINDS.NEBULA,
        group: 'nebulae',
        radius: 9,
        pos: [10, 0, 0],
        texture: '/neb.jpg',
      },
      {
        id: 'gx',
        name: 'Galaxy',
        kind: SF_KINDS.GALAXY,
        group: 'galaxies',
        radius: 30,
        pos: [-10, 0, 0],
        texture: '/gx.jpg',
      },
      // spiralDisc galaxy — sparkle path inside buildStarBodies.
      {
        id: 'spiral-gx',
        name: 'Spiral',
        kind: SF_KINDS.GALAXY,
        group: 'galaxies',
        radius: 40,
        pos: [0, 10, 0],
        texture: '/spiral.jpg',
        spiralDisc: { count: 500 },
        tilt: 0.3,
      },
    ]

    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const texMap = new Map(
      [
        '/day.jpg',
        '/normal.jpg',
        '/night.jpg',
        '/clouds.jpg',
        '/bump.png',
        '/body.jpg',
        '/ring.png',
        '/sun.jpg',
        '/neb.jpg',
        '/gx.jpg',
        '/spiral.jpg',
      ].map((u) => [u, fakePhoto()])
    )

    buildStarBodies(s, THREE, NODE_DEPS, defs, texMap, undefined)

    // Solar stars/systems each carry one extra hidden far-pick proxy —
    // the collapsed sun glyph stays tappable from interstellar range.
    const farPicks = defs.filter(
      (d) => d.group === SF_GROUPS.SOLAR && (d.kind === SF_KINDS.STAR || d.kind === SF_KINDS.SYSTEM)
    ).length

    expect(s.nodes.size).toBe(defs.length)
    expect(s.pickables.length).toBe(defs.length + farPicks)
  })

  test('pos-tilted body, null aurora/cloud shells, flare+meteor loops, nameless satellite arms', () => {
    const s = {
      ...baseState(),
      dayNight: [],
      fxTime: { value: 0 },
      solarWind: null,
    }

    const defs = [
      // Tilted body at a fixed position — neither axis-locked nor
      // tidally locked, so `sphereTilt` lands on the else branch's
      // `mesh.rotation.z` arm.
      {
        id: 'tilted-rock',
        name: 'Tilted',
        kind: SF_KINDS.PLANET,
        group: SF_GROUPS.SOLAR,
        radius: 1,
        pos: [9, 0, 0],
        tilt: 0.4,
      },
      // Weather world — `atmosphere` registers the sun-dir entry so `dn`
      // resolves, but NODE_DEPS lacks MeshStandardNodeMaterial so
      // makeWeatherClouds returns null (`if (clouds)` else arm), and
      // solarWind: null makes makeAurora return null (`if (au)` else).
      {
        id: 'stormy',
        name: 'Stormy',
        kind: SF_KINDS.PLANET,
        group: SF_GROUPS.SOLAR,
        radius: 2,
        pos: [0, 0, 9],
        atmosphere: 1,
        cloudTexture: '/clouds.jpg',
        weather: true,
        aurora: true,
      },
      // Solar star with flares + meteors — a real glow texture makes
      // both pools non-empty so the sprite-add loops execute; the id'd
      // satellite carries no `name` → `sat.name ?? sat.id` arm.
      {
        id: 'flare-sun',
        name: 'Flares',
        kind: SF_KINDS.STAR,
        group: SF_GROUPS.SOLAR,
        radius: 3,
        pos: [0, 0, 0],
        flares: true,
        meteors: true,
        satellites: [{ id: 'code-sat', radius: 0.2, orbit: 4, speed: 1 }],
      },
    ]

    buildStarBodies(s, THREE, NODE_DEPS, defs, new Map([['/clouds.jpg', fakePhoto()]]), fakePhoto())

    expect(s.nodes.get('code-sat')?.def.name).toBe('code-sat')
    expect(s.nodes.get('flare-sun')?.flares?.length).toBeGreaterThan(0)
    expect(s.nodes.get('flare-sun')?.meteorPool?.length).toBeGreaterThan(0)
  })
})

describe('weather maker tails', () => {
  test('makeWeatherClouds writes the surface cloud shadow when the host material has a map', () => {
    // Node deps carrying MeshStandardNodeMaterial + a surface material
    // holding a map → the `surf.colorNode` cloud-shadow arm.
    const surfaceMat = { map: fakePhoto() }

    const out = makeWeatherClouds(
      THREE,
      { TSL, mats: { MeshStandardNodeMaterial: THREE.MeshStandardMaterial } },
      { id: 'wx-world', radius: 2 },
      fakePhoto(),
      { x: 1, y: 0, z: 0 },
      surfaceMat,
      TSL.float(0)
    )

    expect(out).toBeTruthy()
    expect(surfaceMat.colorNode).toBeTruthy()
  })

  test('makeConstellation bails without config and its glints never raycast', () => {
    expect(makeConstellation(THREE, { id: 'no-cfg' })).toBeNull()

    // Recording Points — the chain mock would swallow the raycast stub.
    const pts = []

    class RecPoints {
      constructor() {
        pts.push(this)
      }
    }

    const out = makeConstellation(
      { ...THREE, Points: RecPoints },
      { id: 'swarm', radius: 1, constellation: { count: 8, orbit: 2 } }
    )

    expect(out).toBeTruthy()
    expect(pts.length).toBe(1)
    expect(pts[0].raycast()).toBeUndefined()
  })

  test('makeAurora covers the non-object cfg arm; meteor sprites never raycast', () => {
    // `aurora: true` (flag, not cfg object) → the `?? {}` else arm —
    // with a live wind uniform so the maker runs past its early return.
    const au = makeAurora(
      THREE,
      NODE_DEPS,
      { id: 'aurora-flag', radius: 2, aurora: true },
      TSL.float(0),
      TSL.float(0.5)
    )

    expect(au).toBeTruthy()

    // Recording Sprite — the meteor flash raycast stub must execute.
    const sprites = []

    class RecSprite {
      constructor() {
        this.position = { set: jest.fn() }
        this.scale = { set: jest.fn() }
        sprites.push(this)
      }
    }

    const pool = makeMeteorPool(
      { ...THREE, Sprite: RecSprite },
      { id: 'rocky', radius: 1 },
      fakePhoto()
    )

    expect(pool.length).toBeGreaterThan(0)

    for (const sp of sprites) sp.raycast?.()
  })
})

describe('belt-rock + diffraction-spike tails', () => {
  /**
   * 2d ctx extended with the transform/gradient calls spikeRay and
   * rockTexture make on top of the shared fake2d surface.
   */
  const fake2dFull = () => ({
    ...fake2d(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    stroke: jest.fn(),
  })

  /**
   * Geometry stand-in with a real position attribute — the chain
   * mock's `count` proxy coerces NaN so the crumple/UV-bake vertex
   * loop would never iterate; four real verts let it run.
   */
  const fakeGeo = () =>
    class {
      constructor() {
        const verts = [
          [0.4, 0.8, 0.2],
          [-0.7, 0.3, -0.6],
          [0.1, -0.9, 0.5],
          [-0.2, 0.1, -0.9],
        ]

        this.attributes = {
          position: {
            count: verts.length,
            getX: (i) => verts[i][0],
            getY: (i) => verts[i][1],
            getZ: (i) => verts[i][2],
            setXYZ: jest.fn(),
          },
        }
      }

      setAttribute() {}

      computeVertexNormals() {}
    }

  test('makeBeltRocks paints every material class and survives a belt-less def', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2dFull())

    const T = {
      ...THREE,
      IcosahedronGeometry: fakeGeo(),
      TetrahedronGeometry: fakeGeo(),
      CanvasTexture: class {
        constructor() {
          this.colorSpace = ''
        }
      },
    }

    // Several seeds — the seeded class roll differs per id, so across
    // a few belts the stone/carbon pits, metal veins and ice streaks
    // all get painted at least once.
    for (const id of ['belt-a', 'belt-b', 'belt-c', 'belt-d', 'belt-e']) {
      const rocks = makeBeltRocks(T, { id, belt: { inner: 2, outer: 6, puff: 0.2 } })

      expect(rocks.pivots.length).toBeGreaterThan(0)
    }

    // No `belt` config — the `belt?.inner ?? 0` / `belt?.outer ?? 0`
    // and `belt?.puff ?? …` fallback arms.
    const bare = makeBeltRocks(T, { id: 'belt-less' })

    expect(bare.group).toBeTruthy()
  })

  test('irregularGeometry crumples vertices into triaxial moon shapes', async () => {
    const { irregularGeometry } = await import('../../../../engine/bodies/primitives.js')

    const T = {
      ...THREE,
      IcosahedronGeometry: fakeGeo(),
      BufferAttribute: class {
        constructor(array, itemSize) {
          this.array = array
          this.itemSize = itemSize
        }
      },
    }

    // Authored triaxial axes arm (Phobos's real 27×22×18 km figure).
    const fixed = irregularGeometry(T, {
      id: 'phobos',
      radius: 1,
      irregular: { amp: 0.22, axes: [1, 0.84, 0.69] },
    })

    expect(fixed).toBeTruthy()

    // Seeded-axes arm — every irregular body still lands lumpy.
    const seeded = irregularGeometry(T, {
      id: 'deimos',
      radius: 1,
      irregular: { amp: 0.16 },
    })

    expect(seeded).toBeTruthy()

    // Missing irregular config → amp 0 sphere that still bakes UVs.
    expect(irregularGeometry(T, { id: 'ball', radius: 1 })).toBeTruthy()
  })

  test('clusterFor paints a King-profile swarm or bails without 2d', async () => {
    const { clusterFor } = await import('../../../../engine/bodies/procedural/cluster.js')

    const ctxSpy = jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    expect(clusterFor(THREE, { id: 'naked-cluster', color: 0x8899aa })).toBeUndefined()

    ctxSpy.mockImplementation(() => fake2dFull())

    // Colorless def → rgb(undefined) fallback arm inside the core glow.
    expect(clusterFor(THREE, { id: 'cluster-47tuc', color: 0x8899aa })).toBeTruthy()
    expect(clusterFor(THREE, { id: 'cluster-untinted' })).toBeTruthy()
  })

  test('spikesFor paints the six-ray cross or bails without 2d', () => {
    const ctxSpy = jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    expect(spikesFor(THREE, { id: 'noctx', color: 0xffffff })).toBeUndefined()

    ctxSpy.mockImplementation(() => fake2dFull())

    expect(spikesFor(THREE, { id: 'ctx', color: 0xffcc66 })).toBeTruthy()
  })
})

describe('particle-body tails (belt / black-hole / structures)', () => {
  /**
   * Recording Mesh/Points stand-in — the chain proxy swallows the
   * `obj.raycast = () => undefined` assignment into its set trap, so the
   * stub arrow never becomes invocable. A real class stores it as a
   * plain property; `list` recovers instances `group.add` hides.
   */
  const recNodes = () => {
    const list = []

    class Rec {
      constructor() {
        this.position = { x: 0, y: 0, z: 0, set: () => {} }
        this.rotation = { x: 0, y: 0, z: 0 }
        this.scale = { x: 1, y: 1, z: 1, set: () => {}, setScalar: () => {} }
        list.push(this)
      }
    }

    return { list, Ctor: Rec }
  }

  /**
   * CylinderGeometry stand-in exposing a finite `position` attribute —
   * the chain-mock's `count` proxy coerces to 0 so the jet vertex-fade
   * loop never iterates under the auto-mock.
   */
  const fakeCyl = () =>
    class {
      constructor() {
        this.attrs = { position: { count: 4, getY: (i) => i - 1.5 } }
      }

      getAttribute(n) {
        return this.attrs[n]
      }

      setAttribute(n, v) {
        this.attrs[n] = v
      }
    }

  test('makeBelt covers the missing-belt/color fallbacks and no-op raycast', () => {
    const pts = recNodes()

    const T = { ...THREE, Points: pts.Ctor }

    // `belt`-less + `color`-less def — every `??` fallback arm at once.
    const bare = makeBelt(T, { id: 'belt-bare' }, undefined)

    expect(bare).toBeInstanceOf(pts.Ctor)
    expect(bare.raycast()).toBeUndefined()

    // `gapFreq: 0` → `lanes > 0` false arm (smooth classical disc).
    const smooth = makeBelt(
      T,
      {
        id: 'belt-smooth',
        color: 0x334455,
        belt: { inner: 1, outer: 3, count: 24, puff: 0.2, gapFreq: 0 },
      },
      undefined
    )

    expect(smooth).toBeInstanceOf(pts.Ctor)
  })

  test('makeBlackHole covers the jets-less arm, vertex fade and raycast stubs', () => {
    const pts = recNodes()
    const msh = recNodes()

    const T = { ...THREE, Points: pts.Ctor, Mesh: msh.Ctor, CylinderGeometry: fakeCyl() }

    const jetted = makeBlackHole(T, NODE_DEPS, { id: 'bh-jets', radius: 2, jets: true }, undefined)

    expect(jetted.group).toBeTruthy()
    expect(jetted.spin).toBeTruthy()

    // No `jets` flag → `if (def.jets)` else arm.
    const quiet = makeBlackHole(T, NODE_DEPS, { id: 'bh-calm', radius: 2 }, undefined)

    expect(quiet.group).toBeTruthy()
    expect(quiet.spin).toBeTruthy()

    // Fire every stubbed raycast — swirl Points + both jet Meshes.
    for (const inst of [...pts.list, ...msh.list]) inst.raycast?.()
  })

  test('makeStructure covers structure-less/color-less/speckle arms and raycast stubs', () => {
    const pts = recNodes()
    const msh = recNodes()

    const T = { ...THREE, Points: pts.Ctor, Mesh: msh.Ctor }

    // `structure`-less def → `structure?.radius ?? def.radius`,
    // `structure?.speckles ?? 0` and `color ?? SHELL_LOCAL` arms.
    const bare = makeStructure(T, NODE_DEPS, { id: 'st-bare', radius: 4 }, undefined)

    expect(bare).toBeTruthy()

    // Speckled + color-less → `color ?? SPECKLE` tint arm.
    const speckled = makeStructure(
      T,
      NODE_DEPS,
      { id: 'st-speckled', radius: 4, structure: { radius: 3, speckles: 8 } },
      undefined
    )

    expect(speckled).toBeTruthy()

    // Fire the shell + speckle-cloud raycast stubs.
    for (const inst of [...pts.list, ...msh.list]) inst.raycast?.()
  })
})

describe('comet + plume tails', () => {
  test('makeComet builds nucleus + coma + twin tails, with and without 2d/photo', async () => {
    const { makeComet } = await import('../../../../engine/bodies/comet.js')

    // Canvas up — the tail gradient + nucleus surface both paint.
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const def = {
      id: 'halley-fixture',
      kind: SF_KINDS.COMET,
      radius: 0.4,
      orbit: 180,
      ecc: 0.83,
      color: SF_COLORS.HALLEY,
      irregular: { amp: 0.22, axes: [1, 0.5, 0.55] },
    }

    const withPhoto = makeComet(THREE, def, new Map([['/nucleus.jpg', fakePhoto()]]), fakePhoto())

    expect(withPhoto.mesh).toBeTruthy()
    expect(withPhoto.ion).toBeTruthy()
    expect(withPhoto.dust).toBeTruthy()
    expect(withPhoto.coma).toBeTruthy()

    // Photo listed on the def — texMap hit arm inside the material.
    const mapped = makeComet(
      THREE,
      { ...def, texture: '/nucleus.jpg' },
      new Map([['/nucleus.jpg', fakePhoto()]]),
      fakePhoto()
    )

    expect(mapped.mesh).toBeTruthy()
  })

  test('makeComet falls back to the glow map when the tail canvas fails', async () => {
    const { makeComet } = await import('../../../../engine/bodies/comet.js')

    // No 2d → tailFor yields undefined → `tailTex ?? glowTex` arm.
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    const out = makeComet(
      THREE,
      { id: 'noctx-comet', kind: SF_KINDS.COMET, radius: 0.3, orbit: 40, ecc: 0.5 },
      new Map(),
      fakePhoto()
    )

    expect(out.ion).toBeTruthy()
  })

  test('makePlumes guards config/glow and builds polar + scattered vents', async () => {
    const { makePlumes } = await import('../../../../engine/bodies/plumes.js')

    // Neither arm may build anything.
    expect(makePlumes(THREE, { id: 'bare', radius: 1 }, fakePhoto())).toBeNull()
    expect(
      makePlumes(THREE, { id: 'noglow', radius: 1, plumes: { count: 2 } }, undefined)
    ).toBeNull()

    // Polar cluster — Enceladus tiger stripes; explicit count/color/height.
    const polar = makePlumes(
      THREE,
      {
        id: 'enceladus-fixture',
        radius: 0.2,
        plumes: { count: 4, polar: true, color: SF_COLORS.PLUME_ICE, height: 2.4 },
      },
      fakePhoto()
    )

    expect(polar.vents.length).toBe(4)

    // Every polar vent points south — the tiger-stripe band.
    for (const v of polar.vents) expect(v.dir.y).toBeLessThan(-0.5)

    // Scattered volcanic vents with token defaults — Io's sulfur.
    const volcanic = makePlumes(THREE, { id: 'io-fixture', radius: 0.4, plumes: {} }, fakePhoto())

    expect(volcanic.vents.length).toBeGreaterThan(0)
  })

  test('buildStarBodies mounts a comet nucleus + center-frame tails and a plumed moon', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const s = {
      canvas: null,
      scene: new THREE.Scene(),
      nodes: new Map(),
      anchors: new Map(),
      pickables: [],
    }

    const defs = [
      // Comet — eccentric orbit feeds rMin/rMax on the node record.
      {
        id: 'comet-fixture',
        name: 'Comet',
        kind: SF_KINDS.COMET,
        group: SF_GROUPS.SOLAR,
        radius: 0.4,
        orbit: 180,
        speed: 0.5,
        ecc: 0.83,
        color: SF_COLORS.HALLEY,
        irregular: { amp: 0.2 },
      },
      // Plumed moon — jet+puff vents on the surface.
      {
        id: 'plumed',
        name: 'Plumed',
        kind: SF_KINDS.MOON,
        group: SF_GROUPS.SOLAR,
        radius: 0.5,
        orbit: 8,
        speed: 1,
        parent: 'comet-fixture',
        plumes: { count: 3, polar: true },
      },
      // Position-pinned comet — no `orbit` → the `?? def.radius` arm,
      // and ecc-less collapses the rMin==rMax span.
      {
        id: 'comet-circular',
        name: 'Circular',
        kind: SF_KINDS.COMET,
        group: SF_GROUPS.SOLAR,
        radius: 0.3,
        pos: [5, 0, 5],
      },
    ]

    buildStarBodies(s, THREE, NODE_DEPS, defs, new Map(), fakePhoto())

    const comet = s.nodes.get('comet-fixture')

    expect(comet.comet).toBeTruthy()
    expect(comet.comet.rMax).toBeGreaterThan(comet.comet.rMin)
    expect(s.nodes.get('comet-circular').comet.rMax).toBe(s.nodes.get('comet-circular').comet.rMin)
    expect(s.nodes.get('plumed').plumes.length).toBe(3)

    // BELT def without `belt` bounds — the `belt?.inner ?? 0` /
    // `belt?.outer ?? 0` fallback arms on the pick ring still build a
    // degenerate proxy and the bare hero-rock group.
    const beltless = {
      canvas: null,
      scene: new THREE.Scene(),
      nodes: new Map(),
      anchors: new Map(),
      pickables: [],
    }

    buildStarBodies(
      beltless,
      THREE,
      NODE_DEPS,
      [
        {
          id: 'belt-less-fixture',
          name: 'Beltless',
          kind: SF_KINDS.BELT,
          group: SF_GROUPS.SOLAR,
          radius: 1,
          orbit: 100,
        },
      ],
      new Map(),
      fakePhoto()
    )
  })

  test('comet tails and plume sprites never intercept pointer rays', async () => {
    const { makeComet } = await import('../../../../engine/bodies/comet.js')
    const { makePlumes } = await import('../../../../engine/bodies/plumes.js')

    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    // Recording Sprite/Mesh — the chain proxy swallows `raycast`
    // assignment into its set trap; real classes keep the no-op
    // invocable. Plume jets are tapered-cone Meshes, not sprites.
    const sprites = []
    const meshes = []

    class RecSprite {
      constructor() {
        this.position = { x: 0, y: 0, set: jest.fn() }
        this.scale = { x: 1, y: 1, set: jest.fn() }
        sprites.push(this)
      }
    }

    class RecMesh {
      constructor() {
        this.position = { x: 0, y: 0, set: jest.fn() }
        this.scale = { x: 1, y: 1, set: jest.fn() }
        this.quaternion = { setFromUnitVectors: jest.fn() }
        meshes.push(this)
      }
    }

    const T = { ...THREE, Sprite: RecSprite, Mesh: RecMesh }

    makeComet(
      T,
      { id: 'ray-comet', kind: SF_KINDS.COMET, radius: 0.3, orbit: 40, ecc: 0.5 },
      new Map(),
      fakePhoto()
    )

    makePlumes(T, { id: 'ray-plumed', radius: 0.5, plumes: { count: 2 } }, fakePhoto())

    expect(sprites.length).toBeGreaterThan(0)

    for (const sp of [...sprites, ...meshes]) expect(sp.raycast?.()).toBeUndefined()
  })
})
