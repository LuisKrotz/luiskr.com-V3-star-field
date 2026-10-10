/**
 * @file starfield/star-registry.test.js
 * @description Deep-catalog registry — id grammar, manifest/shard lazy
 * loading with cache semantics, record resolution by rank arithmetic,
 * incremental shard streaming, query search with the match cap, and
 * the heliocentric→chart world-position math (incl. far-field clamp).
 * Fetch is stubbed per test; manifest/shard caches persist for the
 * file, so failure arms run on throwaway kinds and null results are
 * retryable by design.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import {
  ensureRegistryManifest,
  isRegistryId,
  loadRegistryRecord,
  loadRegistryShard,
  parseRegistryId,
  registryWorldPos,
  searchRegistry,
  streamRegistryShards,
} from '../../engine/registry.js'
import { SF_SCALE } from '@core/tokens/starfield/params.js'

const jsonRes = (body) => ({ ok: true, json: async () => body })

const manifest = {
  total: 5,
  shardSize: 1000,
  kinds: {
    star: { count: 3, shards: ['star-000.json'] },
    exoplanet: { count: 1, shards: ['exoplanet-000.json'] },
    dso: { count: 1, shards: ['dso-000.json'] },
  },
}

const starShard = [
  { i: 'star-000000', n: 'Sol', m: -26.7, d: 0, s: 'G2V', x: 0, y: 0, z: 0 },
  { i: 'star-000001', n: 'Sirius', m: -1.4, d: 8.6, s: 'A1V', c: 'CMa', x: -5, y: -6, z: -1 },
  { i: 'star-000002', n: 'Vega', m: 0.0, d: 25, s: 'A0V', x: 10, y: 20, z: 5 },
]

const exoShard = [
  {
    i: 'exoplanet-000000',
    n: 'Kepler-22 b',
    h: 'Kepler-22',
    d: 635,
    s: 'G5',
    y2: '2011',
    x: 1,
    y: 2,
    z: 3,
  },
]

const dsoShard = [
  {
    i: 'dso-000000',
    n: 'Andromeda Galaxy',
    c: 'M31',
    t: 'G',
    m: 3.4,
    d: 2.5e6,
    r: -0.001,
    x: 1e6,
    y: 2e6,
    z: -1e6,
  },
]

const routeFetch = (overrides = {}) =>
  jest.fn(async (url) => {
    const routes = {
      'manifest.json': manifest,
      'star-000.json': starShard,
      'exoplanet-000.json': exoShard,
      'dso-000.json': dsoShard,
      ...overrides,
    }

    for (const [frag, body] of Object.entries(routes)) {
      if (String(url).endsWith(frag)) return jsonRes(body)
    }

    return { ok: false, status: 404 }
  })

let origFetch

beforeEach(() => {
  origFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = origFetch
})

describe('registry id grammar', () => {
  test('isRegistryId accepts kind-rank ids and rejects catalog slugs', () => {
    expect(isRegistryId('star-000042')).toBe(true)
    expect(isRegistryId('exoplanet-001234')).toBe(true)
    expect(isRegistryId('dso-009001')).toBe(true)
    expect(isRegistryId('mars')).toBe(false)
    expect(isRegistryId('andromeda')).toBe(false)
    expect(isRegistryId('star-123')).toBe(false)
    expect(isRegistryId('star-0000042')).toBe(false)
    expect(isRegistryId('quasar-000001')).toBe(false)
  })

  test('parseRegistryId splits kind and rank; null on malformed', () => {
    expect(parseRegistryId('star-000042')).toEqual({ kind: 'star', rank: 42 })
    expect(parseRegistryId('exoplanet-001234')).toEqual({ kind: 'exoplanet', rank: 1234 })
    expect(parseRegistryId('dso-013962')).toEqual({ kind: 'dso', rank: 13962 })
    expect(parseRegistryId('mars')).toBeNull()
    expect(parseRegistryId('star-')).toBeNull()
  })
})

describe('registry manifest + shards', () => {
  test('a failed manifest resolves null and retries next call', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline')
    })

    expect(await ensureRegistryManifest()).toBeNull()

    // A non-ok HTTP status resolves null the same way — still uncached.
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 503 }))

    expect(await ensureRegistryManifest()).toBeNull()

    globalThis.fetch = routeFetch()

    expect((await ensureRegistryManifest())?.total).toBe(5)
  })

  test('manifest resolves once then caches', async () => {
    globalThis.fetch = routeFetch()

    const first = await ensureRegistryManifest()
    const second = await ensureRegistryManifest()

    expect(second).toBe(first)
  })

  test('loadRegistryShard fetches, parses and caches per shard key', async () => {
    globalThis.fetch = routeFetch()

    const shard = await loadRegistryShard('star', 0)
    const again = await loadRegistryShard('star', 0)

    expect(shard?.[1]?.n).toBe('Sirius')
    expect(again).toBe(shard)
  })

  test('loadRegistryShard resolves null on HTTP failure and rejection', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500 }))

    expect(await loadRegistryShard('quasar', 0)).toBeNull()

    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline')
    })

    expect(await loadRegistryShard('meteor', 7)).toBeNull()
  })
})

describe('registry record resolution', () => {
  test('loadRegistryRecord decodes rank → shard/slot', async () => {
    globalThis.fetch = routeFetch()

    const rec = await loadRegistryRecord('star-000001')

    expect(rec?.n).toBe('Sirius')
    expect(rec?.s).toBe('A1V')
  })

  test('malformed ids resolve null without touching the network', async () => {
    expect(await loadRegistryRecord('mars')).toBeNull()
    expect(await loadRegistryRecord('star-99')).toBeNull()
  })

  test('out-of-range ranks resolve null', async () => {
    globalThis.fetch = routeFetch()

    expect(await loadRegistryRecord('star-000099')).toBeNull()
  })

  test('missing shard data resolves null', async () => {
    globalThis.fetch = jest.fn(async (url) =>
      String(url).endsWith('manifest.json') ? jsonRes(manifest) : { ok: false, status: 404 }
    )

    expect(await loadRegistryRecord('dso-000000')).toBeNull()
  })
})

describe('registry streaming + search', () => {
  test('streamRegistryShards yields each shard in order', async () => {
    globalThis.fetch = routeFetch()

    const seen = []

    for await (const shard of streamRegistryShards('star')) {
      seen.push(shard.length)
    }

    expect(seen).toEqual([3])
  })

  test('streamRegistryShards yields nothing for an unknown kind', async () => {
    globalThis.fetch = routeFetch()

    const seen = []

    for await (const shard of streamRegistryShards('asteroid')) {
      seen.push(shard)
    }

    expect(seen).toEqual([])
  })

  test('streamRegistryShards stops when a shard fails', async () => {
    globalThis.fetch = jest.fn(async (url) =>
      String(url).endsWith('manifest.json') ? jsonRes(manifest) : { ok: false, status: 404 }
    )

    const seen = []

    for await (const shard of streamRegistryShards('exoplanet')) {
      seen.push(shard)
    }

    expect(seen).toEqual([])
  })

  test('searchRegistry returns empty for blank queries', async () => {
    globalThis.fetch = routeFetch()

    expect(await searchRegistry('   ')).toEqual([])
  })

  test('searchRegistry matches names, designations and hosts', async () => {
    globalThis.fetch = routeFetch()

    const byName = await searchRegistry('vega')
    const byHost = await searchRegistry('kepler-22')
    const byDesig = await searchRegistry('m31')

    expect(byName[0]?.i).toBe('star-000002')
    expect(byHost[0]?.i).toBe('exoplanet-000000')
    expect(byDesig[0]?.i).toBe('dso-000000')
  })

  test('searchRegistry respects the limit cap', async () => {
    globalThis.fetch = routeFetch()

    const hits = await searchRegistry('a', 2)

    expect(hits.length).toBe(2)
  })
})

describe('registry world positions', () => {
  const mwState = (mwPos = [-420, -120, -300], tilt = 0.35) => ({
    nodes: new Map([['milky-way', { def: { pos: mwPos, tilt } }]]),
  })

  test('resolves null without a Milky Way node or position', () => {
    const s = { nodes: new Map() }

    expect(registryWorldPos(s, starShard[1])).toBeNull()
    expect(
      registryWorldPos({ nodes: new Map([['milky-way', { def: {} }]]) }, starShard[1])
    ).toBeNull()
  })

  test('nearby records sit at the Sun + heliocentric ly→units', () => {
    const p = registryWorldPos(mwState(), { i: 'x', n: 'N', x: -100, y: 0, z: 0 })

    // 100 ly = 1 chart unit (galactic tier); chart +X maps from −x_gal.
    expect(p.x).toBeCloseTo(-(-100) / SF_SCALE.GALACTIC_LY, 5)
    expect(p.y).toBeCloseTo(0, 5)
    expect(p.z).toBeCloseTo(0, 5)
  })

  test('far-field records compress onto the COSMIC_CLAMP shell', () => {
    const p = registryWorldPos(mwState(), { i: 'x', n: 'N', x: -1e9, y: 0, z: 0 })

    // 1 Gly saturates the cosmic tier — radius = COSMIC_CLAMP along +X.
    expect(p.x).toBeCloseTo(SF_SCALE.COSMIC_CLAMP, 5)
  })

  test('galactic z tilts onto the disc normal', () => {
    const p = registryWorldPos(mwState(), { i: 'x', n: 'N', x: 0, y: 0, z: 100 })

    const a = -Math.PI / 2 + 0.35

    // 100 ly = 1 unit on the galactic Y axis, then rotation.x = a leans
    // it onto the disc plane: y = cos(a), z = sin(a).
    expect(p.y).toBeCloseTo(Math.cos(a) * 1, 5)
    expect(p.z).toBeCloseTo(Math.sin(a) * 1, 5)
  })

  test('a Milky Way def without tilt falls back to the untilted frame', () => {
    const s = { nodes: new Map([['milky-way', { def: { pos: [-120, 0, 0] } }]]) }

    const p = registryWorldPos(s, { i: 'x', n: 'N', x: -100, y: 0, z: 0 })

    expect(p.x).toBeCloseTo(1, 5)
    expect(p.y).toBeCloseTo(0, 5)
  })
})
