/**
 * @file starfield/star-dossier.test.js
 * @description Lazy dossier loader — fetchDossier caches per body id and
 * resolves null on HTTP/parse failures; loadDossier fills the component
 * panel and ignores stale resolutions; prefetchDossier warms the cache
 * without touching the host.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { fetchDossier, loadDossier, prefetchDossier } from '../../star/dossier.js'
import { getDevLog, clearDevLog } from '@core/devlog.js'
import { LOG_LEVELS } from '@core/tokens/data/log.js'

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

const jsonRes = (body) => ({ ok: true, json: async () => body })

let origFetch

beforeEach(() => {
  origFetch = globalThis.fetch
  clearDevLog()
})

afterEach(() => {
  globalThis.fetch = origFetch
})

describe('star dossier loader', () => {
  test('fetchDossier resolves the payload and caches per id', async () => {
    const body = { id: 'ceres', name: 'Ceres' }
    const fetchMock = jest.fn(async () => jsonRes(body))

    globalThis.fetch = fetchMock

    const first = await fetchDossier('ceres')
    const second = await fetchDossier('ceres')

    expect(first).toBe(body)
    expect(second).toBe(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('fetchDossier resolves null on a non-ok response', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))

    expect(await fetchDossier('pluto')).toBeNull()
    expect(getDevLog().filter((e) => e.level === LOG_LEVELS.WARN).length).toBeGreaterThan(0)
  })

  test('fetchDossier resolves null when fetch rejects', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline')
    })

    expect(await fetchDossier('sirius')).toBeNull()
    expect(getDevLog().filter((e) => e.level === LOG_LEVELS.ERROR).length).toBeGreaterThan(0)
  })

  test('loadDossier flags loading then publishes the dossier', async () => {
    const body = { id: 'vega', name: 'Vega' }

    globalThis.fetch = jest.fn(async () => jsonRes(body))

    const c = { _updateDom: jest.fn() }

    loadDossier(c, 'vega')

    expect(c._selectedId).toBe('vega')
    expect(c._dossierLoading).toBe(true)
    expect(c._dossier).toBeNull()
    expect(c._updateDom).toHaveBeenCalled()

    await flush()

    expect(c._dossierLoading).toBe(false)
    expect(c._dossier).toBe(body)
  })

  test('loadDossier drops a stale resolution after a newer select', async () => {
    const bodies = {
      trappist: { id: 'trappist-1', name: 'TRAPPIST-1' },
      betel: { id: 'betelgeuse', name: 'Betelgeuse' },
    }
    let release

    globalThis.fetch = jest.fn(
      (url) =>
        new Promise((resolve) => {
          if (String(url).includes('trappist')) release = () => resolve(jsonRes(bodies.trappist))
          else resolve(jsonRes(bodies.betel))
        })
    )

    const c = { _updateDom: jest.fn() }

    loadDossier(c, 'trappist-1')
    loadDossier(c, 'betelgeuse')
    release()
    await flush()

    expect(c._dossier).toBe(bodies.betel)
    expect(c._selectedId).toBe('betelgeuse')
  })

  test('prefetchDossier warms the cache so select resolves instantly', async () => {
    const body = { id: 'helix-nebula', name: 'Helix Nebula' }
    const fetchMock = jest.fn(async () => jsonRes(body))

    globalThis.fetch = fetchMock

    prefetchDossier('helix-nebula')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const c = { _updateDom: jest.fn() }

    loadDossier(c, 'helix-nebula')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(c._dossier).toBe(body)
  })
})

describe('registry dossier synthesis', () => {
  const regManifest = {
    total: 3,
    shardSize: 1000,
    kinds: {
      star: { count: 2, shards: ['star-000.json'] },
      exoplanet: { count: 1, shards: ['exoplanet-000.json'] },
      dso: { count: 1, shards: ['dso-000.json'] },
    },
  }

  const regFetch = () =>
    jest.fn(async (url) => {
      const u = String(url)

      if (u.endsWith('manifest.json')) return jsonRes(regManifest)
      if (u.endsWith('star-000.json'))
        return jsonRes([
          { i: 'star-000000', n: 'Sirius', m: -1.4, d: 8.6, s: 'A1V', c: 'CMa', x: 1, y: 2, z: 3 },
          { i: 'star-000001', n: 'Canopus', m: -0.7, d: 310, s: 'A9II', x: 4, y: 5, z: 6 },
        ])
      if (u.endsWith('exoplanet-000.json'))
        return jsonRes([
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
        ])
      if (u.endsWith('dso-000.json'))
        return jsonRes([
          {
            i: 'dso-000000',
            n: 'Ring Nebula',
            c: 'M57',
            t: 'PN',
            m: 8.8,
            d: 2567,
            r: -0.001,
            x: 1,
            y: 2,
            z: 3,
          },
        ])

      return { ok: false, status: 404 }
    })

  test('star records synthesize spectral facts from the shard', async () => {
    globalThis.fetch = regFetch()

    const d = await fetchDossier('star-000000', 'en', {
      magnitude: 'Apparent magnitude',
      registry_star: 'Catalogued star',
      registry_star_about: 'HYG text',
    })

    expect(d?.name).toBe('Sirius')
    expect(d?.kind).toBe('star')
    expect(d?.tagline).toBe('Catalogued star')
    expect(d?.history).toBe('HYG text')
    expect(d?.source).toContain('HYG')
    expect(d?.meta?.acquired).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const labels = d?.facts.map((f) => f.label)

    expect(labels).toContain('Apparent magnitude')
  })

  test('exoplanet + dso records synthesize their own fact sets', async () => {
    globalThis.fetch = regFetch()

    const exo = await fetchDossier('exoplanet-000000', 'en', { hostStar: 'Host star' })
    const dso = await fetchDossier('dso-000000', 'en', { designation: 'Designation' })

    expect(exo?.kind).toBe('exoplanet')
    expect(exo?.source).toContain('Exoplanet')
    expect(exo?.facts.some((f) => f.value === 'Kepler-22')).toBe(true)
    expect(dso?.kind).toBe('dso')
    expect(dso?.source).toContain('OpenNGC')
    expect(dso?.facts.some((f) => f.value === 'M57')).toBe(true)
  })

  test('unknown registry ids resolve null', async () => {
    globalThis.fetch = regFetch()

    expect(await fetchDossier('star-000007', 'en')).toBeNull()
  })

  test('loadDossier publishes synthesized records into the panel', async () => {
    globalThis.fetch = regFetch()

    const c = { _updateDom: jest.fn(), translations: { registry_star: 'Katalogstern' } }

    loadDossier(c, 'star-000001')
    await flush()

    expect(c._dossier?.name).toBe('Canopus')
    expect(c._dossier?.tagline).toBe('Katalogstern')
    expect(c._dossierLoading).toBe(false)
  })

  test('registryDist formats ly and Mly bands', async () => {
    const { registryDist } = await import('../../star/dossier.js')

    expect(registryDist(undefined)).toBe('—')
    expect(registryDist(8.6)).toBe('9 ly')
    expect(registryDist(2500000)).toBe('2.5 Mly')
  })

  test('an empty label map falls back to raw keys and empty registry prose', async () => {
    globalThis.fetch = regFetch()

    // A fresh `de:` cache key re-synthesizes the record; explicit
    // `undefined` values override the English defaults in the merged
    // label map, forcing the `?? ''` prose fallbacks and the `?? key`
    // fact-label fallback.
    const d = await fetchDossier('star-000000', 'de', {
      registry_star: undefined,
      registry_star_about: undefined,
      magnitude: undefined,
    })

    expect(d?.name).toBe('Sirius')
    expect(d?.tagline).toBe('')
    expect(d?.history).toBe('')
    expect(d?.facts.some((f) => f.value === '-1.4')).toBe(true)
    expect(d?.facts.some((f) => f.label === 'magnitude')).toBe(true)
  })

  test('a redshifted dso record emits the redshift fact', async () => {
    globalThis.fetch = regFetch()

    const d = await fetchDossier('dso-000000', 'en', {})

    expect(d?.facts.some((f) => f.value === '-0.001')).toBe(true)
  })
})

describe('locale dossier fallback', () => {
  const fileFetch = (files, missing = []) =>
    jest.fn(async (url) => {
      const u = String(url)

      for (const frag of missing) {
        if (u.endsWith(frag)) return { ok: false, status: 404 }
      }

      for (const [frag, body] of Object.entries(files)) {
        if (u.endsWith(frag)) return jsonRes(body)
      }

      return { ok: false, status: 404 }
    })

  test('a falsy locale code resolves through the English dossier folder', async () => {
    const body = { id: 'mercury', name: 'Mercury' }

    globalThis.fetch = fileFetch({ 'en/mercury.json': body })

    expect(await fetchDossier('mercury', '')).toBe(body)
  })

  test('a missing locale file falls back to the English dossier', async () => {
    const body = { id: 'neptune', name: 'Neptune' }

    globalThis.fetch = fileFetch({ 'en/neptune.json': body }, ['de/neptune.json'])

    expect(await fetchDossier('neptune', 'de')).toBe(body)
  })

  test('legacy locale aliases resolve to their modern folders', async () => {
    const body = { id: 'uranus', name: 'Uranus' }
    const f = fileFetch({ 'br/uranus.json': body })

    globalThis.fetch = f

    expect(await fetchDossier('uranus', 'pt')).toBe(body)
    expect(f.mock.calls.some((c) => String(c[0]).endsWith('br/uranus.json'))).toBe(true)
  })

  test('applyDossierLocale re-loads the open panel for the new locale', async () => {
    const { applyDossierLocale } = await import('../../star/dossier.js')
    const body = { id: 'saturn', name: 'Saturne' }

    // fetchDossier(null) reads the store's current lang — 'en' under test.
    globalThis.fetch = fileFetch({ 'en/saturn.json': body })

    const c = { _selectedId: 'saturn', _updateDom: jest.fn(), translations: null }

    applyDossierLocale(c)
    await flush()

    expect(c._dossier).toBe(body)
    expect(c._dossierLoading).toBe(false)
  })
})
