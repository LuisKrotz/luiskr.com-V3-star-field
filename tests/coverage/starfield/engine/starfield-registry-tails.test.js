/**
 * @file coverage/starfield/starfield-registry-tails.test.js
 * @description Coverage tails for the 139k registry surface on
 * <view-star-field> — manifest lazy-load on drawer open, incremental
 * shard paging, query search with the stale-response guard, the
 * registry directory sections/rows in render.tsx, and registry-id
 * deep links. Fetch is stubbed so the index never leaves the test.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { SF_CATALOG } from '../../../../engine/catalog.js'

jest.unstable_mockModule('@core/utils/data/db.js', () => ({
  fetchFirebaseDb: jest.fn(async () => ({ exists: () => true, val: () => ({}) })),
}))

await import('../../../../StarField.js')

const manifest = {
  total: 3,
  shardSize: 1000,
  kinds: {
    star: { count: 2, shards: ['star-000.json'] },
    exoplanet: { count: 1, shards: ['exoplanet-000.json'] },
  },
}

const starShard = [
  { i: 'star-000000', n: 'Sirius', m: -1.4, d: 8.6, s: 'A1V', x: 1, y: 2, z: 3 },
  { i: 'star-000001', n: 'Canopus', m: -0.7, d: 310, s: 'A9II', x: 4, y: 5, z: 6 },
]

const exoShard = [
  { i: 'exoplanet-000000', n: 'Kepler-22 b', h: 'Kepler-22', d: 635, x: 1, y: 2, z: 3 },
]

const regFetch = () =>
  jest.fn(async (url) => {
    const u = String(url)

    if (u.endsWith('manifest.json')) return { ok: true, json: async () => manifest }
    if (u.endsWith('star-000.json')) return { ok: true, json: async () => starShard }
    if (u.endsWith('exoplanet-000.json')) return { ok: true, json: async () => exoShard }

    return { ok: false, status: 404 }
  })

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

const mount = () => {
  const el = document.createElement(VIEW_TAGS.VIEW_STAR_FIELD)

  document.body.appendChild(el)

  return el
}

const unmount = (el) => {
  el.onDestroy()
  el.remove()
}

const waitFor = (pred, timeout = 10000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      if (pred()) return resolve()
      if (Date.now() - t0 > timeout) return reject(new Error('waitFor timeout'))
      setTimeout(tick, 15)
    }
    tick()
  })

let origFetch

afterEach(() => {
  globalThis.fetch = origFetch
})

describe('StarField registry directory', () => {
  test('opening the drawer lazy-loads the manifest once', async () => {
    origFetch = globalThis.fetch

    const f = regFetch()

    globalThis.fetch = f

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._ensureRegistry()
    el._ensureRegistry()

    await waitFor(() => el._regManifest !== null)

    expect(el._regManifest.total).toBe(3)
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('manifest.json')).length).toBe(1)

    unmount(el)
  })

  test('_loadMoreRegistry appends shard records and respects bounds', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)

    el._loadMoreRegistry('star')
    await waitFor(() => (el._regRecords.get('star') ?? []).length === 2)

    expect(el._regRecords.get('star')[0].n).toBe('Sirius')

    // Bounds — a kind with all shards loaded is a no-op.
    el._loadMoreRegistry('star')
    await flush(20)

    expect((el._regRecords.get('star') ?? []).length).toBe(2)

    // Unknown kind — no shards declared → immediate no-op.
    el._loadMoreRegistry('asteroid')
    await flush(10)

    unmount(el)
  })

  test('_setSearch queries the registry and stale responses are dropped', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._setSearch('sirius')

    expect(el._regSearching).toBe(true)

    await waitFor(() => el._regSearching === false)

    expect(el._regSearch?.[0]?.i).toBe('star-000000')

    // Newer query wins — the older resolution must not overwrite it.
    el._setSearch('kepler')
    el._setSearch('')

    expect(el._regSearch).toBeNull()

    await flush(30)

    expect(el._regSearch).toBeNull()

    unmount(el)
  })

  test('directory renders registry sections, rows and load-more', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._navOpen = true
    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)

    el._loadMoreRegistry('star')
    await waitFor(() => (el._regRecords.get('star') ?? []).length === 2)
    await flush(20)

    const rows = el.shadowRoot.querySelectorAll(`.${SF_CLASSES.SF_NAV_ITEM}`)

    // All catalog rows + the 2 loaded registry rows.
    expect(rows.length).toBe(SF_CATALOG.length + 2)

    const more = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_MORE}`)

    expect(more).toBeTruthy()

    // Registry row click selects through the same path as catalog rows.
    const selSpy = jest.spyOn(el, '_selectBody')

    const regRow = [...rows].find((b) => b.dataset?.body === 'star-000001')

    regRow.click()

    expect(selSpy).toHaveBeenCalledWith('star-000001')

    // Load-more button drives _loadMoreRegistry.
    const moreSpy = jest.spyOn(el, '_loadMoreRegistry')

    more.click()

    expect(moreSpy).toHaveBeenCalled()

    unmount(el)
  })

  test('_loadMoreRegistry preserves the drawer scroll offset', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._navOpen = true
    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)

    const panel = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_PANEL}`)

    panel.scrollTop = 321

    el._loadMoreRegistry('star')
    await waitFor(() => (el._regRecords.get('star') ?? []).length === 2)

    // The re-render recreated the panel — the offset must be carried over.
    const next = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_PANEL}`)

    expect(next).not.toBe(panel)
    expect(next.scrollTop).toBe(321)

    unmount(el)
  })

  test('_loadMoreRegistry tolerates the panel vanishing mid-render', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._navOpen = true
    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)

    // First $ call reports a scrolled panel, second sees it gone —
    // covers the guarded-restore arm when the drawer unmounts mid-load.
    let calls = 0

    const dollarSpy = jest.spyOn(el, '$').mockImplementation(() => {
      calls += 1

      return calls === 1 ? { scrollTop: 77 } : null
    })

    el._loadMoreRegistry('star')
    await waitFor(() => (el._regRecords.get('star') ?? []).length === 2)

    dollarSpy.mockRestore()

    unmount(el)
  })

  test('search results render under the catalog section while searching', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._navOpen = true
    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)

    el._setSearch('kepler')
    await waitFor(() => el._regSearch !== null && el._regSearch.length > 0)
    await flush(20)

    const rows = el.shadowRoot.querySelectorAll(`.${SF_CLASSES.SF_NAV_ITEM}`)
    const found = [...rows].find((b) => b.dataset?.body === 'exoplanet-000000')

    expect(found).toBeTruthy()

    unmount(el)
  })

  test('registry deep link selects and synthesizes the panel', async () => {
    origFetch = globalThis.fetch
    globalThis.fetch = regFetch()

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._selectBody('star-000000')
    await waitFor(() => el._dossier !== null)

    expect(el._dossier?.name).toBe('Sirius')
    expect(el._dossier?.kind).toBe('star')

    unmount(el)
  })
})
