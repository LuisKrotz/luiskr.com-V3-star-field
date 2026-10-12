/**
 * @file coverage/starfield/engine/starfield-procedural-tails.test.js
 * @description Coverage tails for the procedural imagery layer —
 * procedural.ts surface/corona/gas generators (ctx-null arm, all three
 * surface styles, destination-out wisps), the deep-sky gas fallback,
 * the spiral volumetric dust lane, bodies-scene corona registration,
 * and the frame.ts corona animation hook. three.js is auto-mocked
 * (chainable proxies), so assertions target spy calls and node shape.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'

const NODE_DEPS = { TSL, mats: { MeshBasicNodeMaterial } }

import {
  surfaceFor,
  coronaFor,
  haloFor,
  pointGlowFor,
  starSurfaceFor,
  gasFor,
} from '../../../../engine/bodies/procedural.js'
import { makeNebulaSprite } from '../../../../engine/bodies/deep-sky.js'
import { makeSpiralGalaxy } from '../../../../engine/spiral.js'
import { buildStarBodies } from '../../../../engine/bodies-scene.js'
import { createStarState } from '../../../../engine/state.js'
import { tickStar } from '../../../../engine/frame.js'
import { SF_GROUPS, SF_KINDS } from '@core/tokens/starfield/kinds.js'

const ctxProto = () => window.HTMLCanvasElement.prototype

/** Fake 2d context covering every call the generators make. */
const fake2d = () => ({
  canvas: { width: 1, height: 1 },
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
  quadraticCurveTo: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('procedural generators', () => {
  test('all three generators bail when no 2d context exists', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    const def = { id: 'x', kind: SF_KINDS.MOON, color: 0x888888 }

    expect(surfaceFor(THREE, def)).toBeUndefined()
    expect(coronaFor(THREE, def)).toBeUndefined()
    expect(gasFor(THREE, def)).toBeUndefined()
  })

  test('surfaceFor paints a seeded surface for every style arm', () => {
    const ctx = fake2d()

    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => ctx)

    // Rocky kinds — mottle + craters (and the icy-streak sub-arm).
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) {
      expect(surfaceFor(THREE, { id, kind: SF_KINDS.MOON, color: 0x998877 })).toBeTruthy()
    }

    // Generic planet-ish defs — bands/mottle/streaks all reachable via seeds.
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) {
      expect(surfaceFor(THREE, { id, kind: SF_KINDS.PLANET, color: 0x334455 })).toBeTruthy()
    }

    // Colorless def — rgb() fallback arm.
    expect(surfaceFor(THREE, { id: 'p0', kind: SF_KINDS.PLANET })).toBeTruthy()

    expect(ctx.fillRect).toHaveBeenCalled()
  })

  test('coronaFor paints streamers + flare knots', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    // Active star (Sun-catalog activity) — crosses _CORONA_PLUME_MIN so
    // the H-alpha eruption-plume block paints.
    expect(coronaFor(THREE, { id: 'sol', color: 0xffddaa, activity: 1.7 })).toBeTruthy()
    expect(coronaFor(THREE, { id: 'vega', color: 0xaaccff })).toBeTruthy()
  })

  test('haloFor serves the cached annulus on repeat ids', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const def = { id: 'halo-star', color: 0xffcc88 }

    expect(haloFor(THREE, def)).toBeTruthy()

    // Second call with the same id returns the memoized texture — the
    // `if (cached)` arm inside haloFor.
    expect(haloFor(THREE, def)).toBe(haloFor(THREE, def))
  })

  test('pointGlowFor paints the filled core glow and serves the cache', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const def = { id: 'point-halo', color: 0x99bbff }

    expect(pointGlowFor(THREE, def)).toBeTruthy()

    // Same-id call returns the memoized texture — the `if (cached)` arm.
    expect(pointGlowFor(THREE, def)).toBe(pointGlowFor(THREE, def))
  })

  test('starSurfaceFor paints sunspot groups on active stars', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    // activity 1.7 (Sun catalog) > _SPOT_MIN — umbra/penumbra groups draw.
    expect(starSurfaceFor(THREE, { id: 'sun', color: 0xffbb66, activity: 1.7 })).toBeTruthy()

    // Quiet dwarf — activity defaults to 1, below the spot threshold.
    expect(starSurfaceFor(THREE, { id: 'quiet', color: 0xffeecc })).toBeTruthy()
  })

  test('gasFor paints lobes + destination-out absorption wisps', () => {
    const ctx = fake2d()

    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => ctx)

    expect(gasFor(THREE, { id: 'neb-1', color: 0xaa3366 })).toBeTruthy()
    expect(gasFor(THREE, { id: 'neb-2' })).toBeTruthy()

    expect(ctx.stroke).toHaveBeenCalled()
  })
})

describe('deep-sky gas fallback', () => {
  test('photo-less nebula sprite takes the generated gas map', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const sprite = makeNebulaSprite(
      THREE,
      { id: 'gasless', kind: SF_KINDS.NEBULA, color: 0x224466, radius: 8 },
      new Map(),
      undefined,
      3
    )

    expect(sprite).toBeTruthy()
  })

  test('ctx-less env keeps the glow fallback arm', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => null)

    expect(
      makeNebulaSprite(
        THREE,
        { id: 'nogas', kind: SF_KINDS.NEBULA, color: 0x224466, radius: 8 },
        new Map(),
        undefined,
        3
      )
    ).toBeTruthy()
  })
})

describe('volumetric dust lane', () => {
  test('milky-way spiral composes the dust occluder layer', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    // Recording Points stand-in — fires the star + dust raycast stubs.
    const list = []

    class RecPoints {
      constructor(geo, mat) {
        this.geometry = geo
        this.material = mat
        this.userData = {}
        this.position = { x: 0, y: 0, z: 0, set: () => {} }
        this.rotation = { x: 0, y: 0, z: 0 }
        this.scale = { x: 1, y: 1, z: 1, set: () => {}, setScalar: () => {} }
        list.push(this)
      }
    }

    const T = { ...THREE, Points: RecPoints }

    const out = makeSpiralGalaxy(
      T,
      {
        id: 'milky-way',
        radius: 100,
        tilt: 0.35,
        pos: [-267, 0, 0],
        spin: 0.02,
        spiralDisc: { count: 2000, volumetric: true, bubble: 30 },
      },
      new Map(),
      undefined,
      false
    )

    expect(out.group).toBeTruthy()

    // `spin` on a volumetric galaxy splits the fill at INNER_SPIN_R —
    // the inner disc + inner dust ride the rotor around the galactic
    // center while the outer layers stay fixed around the carved
    // heliocentric bubble.
    expect(out.rotor).toBeTruthy()

    // Inner + outer star clouds, inner + outer dust lanes — all four
    // carry no-op raycasts.
    expect(list.length).toBeGreaterThanOrEqual(4)

    for (const inst of list) inst.raycast?.()

    // Bubble without `pos` and no `spin` — the carve guard's pos-less
    // arm plus the volumetric-without-rotor arm of the dust split.
    const anchorless = makeSpiralGalaxy(
      T,
      {
        id: 'anchorless',
        radius: 50,
        spiralDisc: { count: 100, volumetric: true, bubble: 30 },
      },
      new Map(),
      undefined,
      false
    )

    expect(anchorless.rotor).toBeUndefined()
  })
})

describe('corona registration + animation', () => {
  test('stars register a corona node and updateFx animates it', () => {
    jest.spyOn(ctxProto(), 'getContext').mockImplementation(() => fake2d())

    const s = createStarState(document.createElement('canvas'))

    s.scene = new THREE.Scene()

    const defs = [
      // Solar-group stars keep a resolved photosphere + corona — the
      // only tier where a star's disc is ever resolvable.
      {
        id: 'corona-star',
        kind: SF_KINDS.STAR,
        group: SF_GROUPS.SOLAR,
        radius: 3,
        pos: [0, 0, 0],
        color: 0xffcc88,
      },
      // SYSTEM kind — the second luminous arm.
      {
        id: 'corona-sys',
        kind: SF_KINDS.SYSTEM,
        group: SF_GROUPS.SOLAR,
        radius: 2,
        pos: [10, 0, 0],
        color: 0x88ccff,
      },
      // Galactic star — point-star path: sphere-less group, pick proxy,
      // point halo, no corona; satellites scale to the point radius.
      {
        id: 'point-star',
        kind: SF_KINDS.STAR,
        group: SF_GROUPS.MILKY_WAY,
        radius: 0.04,
        pos: [20, 0, 0],
        color: 0xff8899,
        satellites: [{ radius: 0.01, orbit: 0.1, speed: 1 }],
      },
    ]

    buildStarBodies(s, THREE, NODE_DEPS, defs, new Map(), undefined)

    const point = s.nodes.get('point-star')

    expect(point.corona).toBeUndefined()
    expect(point.satPivots?.length).toBe(1)

    s.nodes.delete('point-star')

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    for (const node of s.nodes.values()) {
      expect(node.corona).toBeTruthy()
      node.corona.material.rotation = 0
      node.corona.material.opacity = 0
    }

    tickStar(s, 5000)

    for (const node of s.nodes.values()) {
      const co = node.corona

      // updateFx advanced rotation and breathed opacity from the baseline.
      expect(co.material.rotation).toBeCloseTo(co.phase + s.t * co.rate)
      expect(co.material.opacity).toBeGreaterThan(0.3)
      expect(co.material.opacity).toBeLessThanOrEqual(0.75)
    }

    raf.mockRestore()
  })
})
