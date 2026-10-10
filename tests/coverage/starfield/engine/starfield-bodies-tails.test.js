/**
 * @file coverage/starfield/engine/starfield-bodies-tails.test.js
 * @description Coverage tails for the photographic bodies layer —
 * mask.ts edge feathering (photoSize arms, missing ctx, composite
 * canvas), deep-sky.ts nebula sprite + galaxy disc (photo path, aspect
 * arms, glow fallbacks, localTilt), spiral.ts photo-disc + sparkle arms,
 * and the bodies-scene detail map / ring-UV / cloud / halo branches.
 * three.js is auto-mocked (chainable proxies), so assertions target
 * spy calls and pure helpers rather than graph internals.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'

/** TSL namespace + node-material ctor bundle injected into body makers. */
const NODE_DEPS = { TSL, mats: { MeshBasicNodeMaterial } }

import { maskPhotoTexture, photoSize } from '../../../../engine/bodies/mask.js'
import { makeGalaxyDisc, makeNebulaSprite } from '../../../../engine/bodies/deep-sky.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { buildStarBodies } from '../../../../engine/bodies-scene.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { SF_COLORS } from '@core/tokens/starfield/params.js'

const ctxProto = () => window.HTMLCanvasElement.prototype

/** Fake 2d context surface covering every call maskPhotoTexture makes. */
const fake2d = () => ({
  drawImage: jest.fn(),
  createRadialGradient: () => ({ addColorStop: jest.fn() }),
  fillStyle: '',
  globalCompositeOperation: '',
  fillRect: jest.fn(),
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
