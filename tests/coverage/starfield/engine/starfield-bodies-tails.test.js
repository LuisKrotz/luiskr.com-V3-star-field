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
import { makeGalaxyDisc, makeNebulaSprite } from '../../../../engine/bodies/deep-sky.js'
import { makeBelt } from '../../../../engine/bodies/belt.js'
import { makeBlackHole } from '../../../../engine/bodies/black-hole.js'
import { makeStructure } from '../../../../engine/bodies/structures.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { buildStarBodies } from '../../../../engine/bodies-scene.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
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
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
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
    expect(maskPhotoTexture(THREE, { image: { naturalWidth: 0, naturalHeight: 4 } })).toBeUndefined()

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
    for (const dims of [[400, 800], [800, 400]]) {
      const texMap = new Map([['/n.jpg', fakePhoto(...dims)]])

      expect(
        makeNebulaSprite(THREE, { id: 'n', texture: '/n.jpg', color: 0x112233, radius: 10 }, texMap, undefined)
      ).toBeTruthy()
    }

    // Photo listed on the def but absent from the map → same-object arm.
    expect(
      makeNebulaSprite(THREE, { id: 'n2', texture: '/absent.jpg', color: 0x112233, radius: 10 }, new Map(), undefined)
    ).toBeTruthy()

    // No texture field at all → procedural glow tint fallback.
    expect(
      makeNebulaSprite(THREE, { id: 'g', color: 0xff00ff, radius: 5 }, new Map(), undefined)
    ).toBeTruthy()
  })

  test('nebula sprite survives an unloadable-mask path (ctx null)', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    const texMap = new Map([['/n.jpg', fakePhoto()]])

    expect(
      makeNebulaSprite(THREE, { id: 'n', texture: '/n.jpg', color: 0x101010, radius: 5 }, texMap, undefined)
    ).toBeTruthy()
  })

  test('galaxy disc covers photo plane, localTilt override + glow fallback', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const texMap = new Map([['/g.jpg', fakePhoto(200, 100)]])

    expect(
      makeGalaxyDisc(THREE, { id: 'g', texture: '/g.jpg', radius: 10, tilt: 0.5 }, texMap, undefined)
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
    expect(makeGalaxyDisc(THREE, { id: 'g3', radius: 8, color: 0x223344 }, texMap, undefined)).toBeTruthy()
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
    rings: [],
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

    expect(s.nodes.size).toBe(defs.length)
    expect(s.pickables.length).toBe(defs.length)
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
      { id: 'belt-smooth', color: 0x334455, belt: { inner: 1, outer: 3, count: 24, puff: 0.2, gapFreq: 0 } },
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
