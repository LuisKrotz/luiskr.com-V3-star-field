/**
 * @file coverage/starfield/engine/registry-guard-tails.test.js
 * @description Coverage tails for the defensive arms of
 * loadRegistryRecord — a resolved manifest that doesn't declare the
 * requested kind, and a shard payload that isn't an array (truncated or
 * error-shaped JSON). Both need a fresh module instance: the shared
 * suite's manifest/shard caches are already warm by the time these
 * arms would run.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'

const { loadRegistryRecord } = await import('../../../../engine/registry.js')
const { fetchDossier } = await import('../../../../star/dossier.js')

const jsonRes = (body) => ({ ok: true, json: async () => body })

const manifest = {
  total: 1002,
  shardSize: 1000,
  kinds: {
    star: { count: 1001, shards: ['star-000.json', 'star-001.json'] },
    exoplanet: { count: 1, shards: ['exoplanet-000.json'] },
  },
}

let origFetch

afterEach(() => {
  globalThis.fetch = origFetch
})

describe('loadRegistryRecord defensive arms', () => {
  test('a manifest missing the kind resolves null without a shard fetch', async () => {
    origFetch = globalThis.fetch

    const f = jest.fn(async (url) =>
      String(url).endsWith('manifest.json') ? jsonRes(manifest) : jsonRes([])
    )

    globalThis.fetch = f

    // 'dso' is a valid registry id grammar but absent from the manifest —
    // the record must resolve null without fetching a shard that the
    // manifest never declared.
    expect(await loadRegistryRecord('dso-000000')).toBeNull()
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('.json') && !String(c[0]).endsWith('manifest.json')).length).toBe(0)
  })

  test('a shard slot outside the loaded rows resolves null', async () => {
    origFetch = globalThis.fetch

    globalThis.fetch = jest.fn(async (url) =>
      String(url).endsWith('manifest.json')
        ? jsonRes(manifest)
        : jsonRes([{ i: 'star-000000', n: 'Sol', m: -26.7, s: 'G2V', x: 0, y: 0, z: 0 }])
    )

    // `star-000001` is a valid rank under the manifest, but the shard
    // payload only carries row 0 — `shard[slot] ?? null` yields null.
    expect(await loadRegistryRecord('star-000001')).toBeNull()
  })

  test('a malformed (non-array) shard payload resolves null', async () => {
    origFetch = globalThis.fetch

    globalThis.fetch = jest.fn(async (url) =>
      String(url).endsWith('manifest.json')
        ? jsonRes(manifest)
        : jsonRes({ error: 'truncated shard' })
    )

    // `star-001000` routes to shard 1 — `star-000` is already cached from
    // the slot test above, so this fetch exercises a fresh shard key.
    expect(await loadRegistryRecord('star-001000')).toBeNull()
  })

  test('a record without a distance skips the distance fact', async () => {
    origFetch = globalThis.fetch

    globalThis.fetch = jest.fn(async (url) =>
      String(url).endsWith('manifest.json')
        ? jsonRes(manifest)
        : jsonRes([
            { i: 'exoplanet-000000', n: 'Nameless b', h: 'HD 1', x: 1, y: 2, z: 3 },
          ])
    )

    const d = await fetchDossier('exoplanet-000000', 'en', {})

    expect(d?.name).toBe('Nameless b')
    expect(d?.facts.some((f) => f.value === 'HD 1')).toBe(true)
    expect(d?.facts.every((f) => f.label !== 'Distance')).toBe(true)
  })
})
