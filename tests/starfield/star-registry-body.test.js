/**
 * @file starfield/star-registry-body.test.js
 * @description Lazy registry-body spawner — the deep catalog's 139k
 * records start as plain cloud points; ensureRegistryBody materializes
 * a real textured object (spectral star, procedural exoplanet, DSO
 * speckle cloud) at the record's heliocentric position, LRU-caps the
 * live set and disposes evictions so GPU buffers never accumulate.
 * THREE and the TSL namespace run under the shared auto-mocks.
 */
import { describe, test, expect, jest } from '@jest/globals'
import * as THREE from 'three'
import * as TSL from 'three/tsl'
import { SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { disposeRegistryBodies, ensureRegistryBody } from '../../engine/registry-body.js'

/** Engine-state stub with the lazy-spawn handles bootstrap stashes. */
const mkState = (over = {}) => ({
  THREE,
  deps: { TSL, mats: { MeshBasicNodeMaterial: THREE.MeshBasicMaterial } },
  disposed: false,
  glowTex: { owned: 'shared-glow' },
  registryBodies: new Map(),
  nodes: new Map([
    ['sun', { pivot: { add: jest.fn() }, def: {} }],
    ['milky-way', { def: { tilt: 0.1 } }],
  ]),
  ...over,
})

const STAR_REC = { i: 'star-000000', n: 'Sirius', m: -1.4, s: 'A1V', x: 1, y: 2, z: 3 }

const EXO_REC = { i: 'exoplanet-000000', n: 'Kepler-22 b', x: 4, y: 5, z: 6 }

const DSO_REC = { i: 'dso-009001', n: 'NGC 1234', t: 'G', x: 7, y: 8, z: 9 }

describe('ensureRegistryBody', () => {
  test('spawns a spectral star, an exoplanet and a DSO at their chart positions', () => {
    const s = mkState()

    ensureRegistryBody(s, STAR_REC)
    ensureRegistryBody(s, EXO_REC)
    ensureRegistryBody(s, DSO_REC)

    expect(s.registryBodies.size).toBe(3)
    expect(s.nodes.get('sun').pivot.add).toHaveBeenCalledTimes(3)
  })

  test('no-ops without THREE, when disposed, or without scene pivots', () => {
    const s = mkState({ THREE: null })

    ensureRegistryBody(s, STAR_REC)
    expect(s.registryBodies.size).toBe(0)

    const dead = mkState({ disposed: true })

    ensureRegistryBody(dead, STAR_REC)
    expect(dead.registryBodies.size).toBe(0)

    const noSun = mkState({
      nodes: new Map([['milky-way', { def: {} }]]),
    })

    ensureRegistryBody(noSun, STAR_REC)
    expect(noSun.registryBodies.size).toBe(0)

    const noMw = mkState({ nodes: new Map([['sun', { pivot: { add: jest.fn() } }]]) })

    ensureRegistryBody(noMw, STAR_REC)
    expect(noMw.registryBodies.size).toBe(0)
  })

  test('re-selecting a cached body only refreshes its LRU slot', () => {
    const s = mkState()

    ensureRegistryBody(s, STAR_REC)
    ensureRegistryBody(s, STAR_REC)

    expect(s.registryBodies.size).toBe(1)
    expect(s.nodes.get('sun').pivot.add).toHaveBeenCalledTimes(1)
  })

  test('evicts + disposes the oldest spawn past BODY_CACHE', () => {
    const s = mkState()

    for (let i = 0; i <= SF_STAR_CLOUD.BODY_CACHE; i++) {
      ensureRegistryBody(s, {
        ...STAR_REC,
        i: `star-${String(i).padStart(6, '0')}`,
        s: i % 2 ? 'M3' : undefined,
        m: i % 3 ? 9 : -2,
      })
    }

    expect(s.registryBodies.size).toBe(SF_STAR_CLOUD.BODY_CACHE)
    expect(s.registryBodies.has('star-000000')).toBe(false)
  })

  test('spawns every DSO tint class and untilted galaxies', () => {
    const s = mkState({
      glowTex: null,
      nodes: new Map([
        ['sun', { pivot: { add: jest.fn() }, def: {} }],
        ['milky-way', { def: {} }],
      ]),
    })

    for (const [ix, t] of ['SNR', 'OC', 'G', 'XX'].entries()) {
      ensureRegistryBody(s, { ...DSO_REC, i: `dso-00000${ix}`, t })
    }

    ensureRegistryBody(s, { ...DSO_REC, i: 'dso-000009', t: undefined })

    expect(s.registryBodies.size).toBe(5)
  })
})

describe('disposeRegistryBodies', () => {
  test('disposes owned geometry/materials/textures, keeps the shared glow sprite', () => {
    const s = mkState()

    const geoDispose = jest.fn()
    const matDispose = jest.fn()
    const texDispose = jest.fn()
    const glowDispose = jest.fn()
    const parentRemove = jest.fn()

    // Real traversal tree — geometry, owned texture, shared-glow
    // exclusion, material-less and dispose-less members all covered.
    const kids = [
      { geometry: { dispose: geoDispose }, material: { map: s.glowTex, dispose: matDispose } },
      {
        geometry: { dispose: geoDispose },
        material: { map: { dispose: texDispose }, dispose: matDispose },
      },
      { material: {} },
      {},
    ]

    const root = {
      traverse: (cb) => kids.forEach(cb),
      parent: { remove: parentRemove },
    }

    s.glowTex.dispose = glowDispose
    s.registryBodies.set('star-000000', root)

    disposeRegistryBodies(s)

    expect(s.registryBodies.size).toBe(0)
    expect(geoDispose).toHaveBeenCalledTimes(2)
    expect(texDispose).toHaveBeenCalledTimes(1)
    expect(glowDispose).not.toHaveBeenCalled()
    expect(parentRemove).toHaveBeenCalledTimes(1)
  })
})
