/**
 * @file coverage/starfield/component/starfield-route-tails.test.js
 * @description Coverage tails for <view-star-field> route/deep-link
 * wiring and the dossier render surface — arrow-key orbit delegation,
 * _syncUrl/_baseStarPath push math, the onRouteParamChange echo guard,
 * _applyDeepLink, the hover tooltip label upgrade + tracking, the
 * loadRegistryShard null arm, and the dossier media/sections/keyboard
 * branches in star/render.tsx.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { KEYS } from '@core/tokens/primitives.js'
import router from '@core/router/router.js'
import { LOCALES } from '@core/tokens/locales.js'

jest.unstable_mockModule('@core/utils/data/db.js', () => ({
  fetchFirebaseDb: jest.fn(async () => ({ exists: () => true, val: () => ({}) })),
}))

await import('../../../../StarField.js')

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

const SF_ROUTE = { view: VIEW_TAGS.VIEW_STAR_FIELD, path: '/star-field', params: {} }

let origFetch
let origRoute
let origNavigate

afterEach(() => {
  globalThis.fetch = origFetch
  router.currentRoute = origRoute
  router.handleNavigation = origNavigate
})

describe('StarField route + interaction tails', () => {
  test('arrow keys orbit the camera through the engine delegate', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    const el = mount()

    await waitFor(() => el._sfReady === true)

    const rotateSpy = jest.spyOn(el._engine, 'rotateView')

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: KEYS.ARROW_LEFT }))
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: KEYS.ARROW_DOWN }))

    expect(rotateSpy).toHaveBeenCalled()

    // Engine missing → the delta path stays inert.
    const eng = el._engine

    el._engine = null
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: KEYS.ARROW_RIGHT }))

    expect(rotateSpy).toHaveBeenCalledTimes(2)

    el._engine = eng

    unmount(el)
  })

  test('selecting pushes /<body> onto the localized chart path', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    router.currentRoute = { ...SF_ROUTE }
    router.handleNavigation = jest.fn(async () => {})

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._syncUrl('mars')

    expect(router.handleNavigation).toHaveBeenCalledWith('/star-field/mars')

    // Same-body echo → no navigation.
    router.currentRoute = { ...SF_ROUTE, path: '/star-field/mars', params: { body: 'mars' } }
    router.handleNavigation.mockClear()
    el._syncUrl('mars')

    expect(router.handleNavigation).not.toHaveBeenCalled()

    // Close strips the body segment back to the chart root.
    el._selectedId = 'mars'
    el._closePanel()

    expect(router.handleNavigation).toHaveBeenCalledWith('/star-field')

    // _baseStarPath arms — body param + matching suffix slices; body
    // param + mismatched path keeps it whole; no body returns the path.
    router.currentRoute = { ...SF_ROUTE, path: '/star-field/mars', params: { body: 'mars' } }

    expect(el._baseStarPath()).toBe('/star-field')

    router.currentRoute = { ...SF_ROUTE, path: '/star-field', params: { body: 'mars' } }

    expect(el._baseStarPath()).toBe('/star-field')

    router.currentRoute = { ...SF_ROUTE }

    expect(el._baseStarPath()).toBe('/star-field')

    // No route at all → _syncUrl bails, _baseStarPath resolves empty.
    router.currentRoute = null
    router.handleNavigation.mockClear()
    el._syncUrl('mars')

    expect(router.handleNavigation).not.toHaveBeenCalled()
    expect(el._baseStarPath()).toBe('')

    unmount(el)
  })

  test('onRouteParamChange selects on a body param and closes without one', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
    router.currentRoute = { ...SF_ROUTE, path: '/star-field/venus', params: { body: 'venus' } }
    router.handleNavigation = jest.fn(async () => {})

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el.onRouteParamChange(router.currentRoute)

    expect(el._selectedId).toBe('venus')

    // Repeat echo with the same selection — idempotent, no reselect.
    const selSpy = jest.spyOn(el, '_selectBody')

    el.onRouteParamChange(router.currentRoute)

    expect(selSpy).not.toHaveBeenCalled()

    // Route lost the param → the panel closes.
    router.currentRoute = { ...SF_ROUTE }
    el.onRouteParamChange(router.currentRoute)

    expect(el._selectedId).toBeNull()

    // A non-star-field route resolves body → null, so the echo closes
    // the panel the same way a param-less same-view route does.
    router.currentRoute = { view: VIEW_TAGS.VIEW_HOME, path: '/', params: {} }
    el._selectedId = 'mars'
    el.onRouteParamChange(router.currentRoute)

    expect(el._selectedId).toBeNull()

    unmount(el)
  })

  test('onRouteParamChange accepts registry ids and ignores unknown bodies', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
    router.currentRoute = { ...SF_ROUTE }
    router.handleNavigation = jest.fn(async () => {})

    const el = mount()

    await waitFor(() => el._sfReady === true)

    // Registry grammar ids bypass the catalog-name map — isRegistryId arm.
    router.currentRoute = {
      ...SF_ROUTE,
      path: '/star-field/star-000000',
      params: { body: 'star-000000' },
    }
    el.onRouteParamChange(router.currentRoute)

    expect(el._selectedId).toBe('star-000000')

    // An unknown body is neither catalog nor registry → inert, selection kept.
    router.currentRoute = { ...SF_ROUTE, path: '/star-field/bogus', params: { body: 'bogus' } }
    el.onRouteParamChange(router.currentRoute)

    expect(el._selectedId).toBe('star-000000')

    unmount(el)
  })

  test('_applyDeepLink selects the URL body once the engine is ready', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
    router.currentRoute = { ...SF_ROUTE, path: '/star-field/saturn', params: { body: 'saturn' } }
    router.handleNavigation = jest.fn(async () => {})

    const el = mount()

    await waitFor(() => el._sfReady === true)

    // onReady already applied the deep link during boot.
    await waitFor(() => el._selectedId === 'saturn')

    // Registry grammar ids bypass the catalog-name map — the
    // `isRegistryId(body)` arm of `_applyDeepLink`'s guard.
    router.currentRoute = {
      ...SF_ROUTE,
      path: '/star-field/star-000000',
      params: { body: 'star-000000' },
    }
    el._applyDeepLink()

    expect(el._selectedId).toBe('star-000000')

    unmount(el)
  })

  test('hover resolves the dossier name upgrade into the tooltip label', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async (url) =>
      String(url).endsWith('/earth.json')
        ? { ok: true, json: async () => ({ id: 'earth', name: 'Terra' }) }
        : { ok: false, status: 404 }
    )

    const el = mount()

    await waitFor(() => el._sfReady === true)

    // Boot prefetch warmed every `en:` dossier key to null under the 404
    // mocks — hover under `de` so the dossier fetch is a fresh cache key.
    const store = (await import('@core/store.js')).default
    const spy = jest.spyOn(store.getters, 'getLang').mockReturnValue(LOCALES.DE)

    el._handleHover('earth')
    await flush(30)

    const label = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_TIP_LABEL}`)

    expect(label.textContent).toContain('Terra')

    // A second hover of a null-dossier body exercises the `name &&` false
    // arm inside the resolve callback.
    el._handleHover('moon')
    await flush(10)

    // Tip element missing at resolve time — `tip?.querySelector` null arm.
    const origQuery = el.$

    el.$ = () => null
    el._handleHover('earth')
    await flush(10)

    // Tip present but label node missing — `if (label)` false arm.
    el.$ = () => ({
      querySelector: () => null,
      style: {},
      setAttribute: () => {},
      removeAttribute: () => {},
    })
    el._handleHover('earth')
    await flush(10)

    el.$ = origQuery
    spy.mockRestore()

    unmount(el)
  })

  test('_handleHoverMove positions the tooltip and survives a missing tip', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._handleHoverMove('mars', 12.6, 34.2)

    const tip = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_TIP}`)

    expect(tip.style.transform).toContain('translate(13px, 34px)')

    const origQuery = el.$

    el.$ = () => null
    el._handleHoverMove('mars', 0, 0)
    el._handleHover('mars')
    el.$ = origQuery

    unmount(el)
  })

  test('_loadMoreRegistry tolerates a failed shard fetch', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    // NB: this test runs before the registry-hover/search tests
    // deliberately — the module-level manifest/shard caches make
    // whichever registry fetch lands first authoritative for the whole
    // file. star-000 carries every record the later tests need:
    // `star-000000`→'Rigil' for hover, the two 'Sirius' rows for search
    // (the quasar id exercises `t[kind] || kind`'s raw fallback).
    globalThis.fetch = jest.fn(async (url) => {
      const u = String(url)

      if (u.endsWith('manifest.json'))
        return {
          ok: true,
          json: async () => ({
            total: 3,
            shardSize: 1000,
            kinds: {
              star: {
                count: 3,
                shards: ['star-000.json', 'star-001.json', 'star-002.json'],
              },
            },
          }),
        }
      if (u.endsWith('star-000.json'))
        return {
          ok: true,
          json: async () => [
            { i: 'star-000000', n: 'Rigil', m: 0, d: 4.3, x: 1, y: 0, z: 0 },
            { i: 'star-000001', n: 'Sirius', d: 8.6, x: 1, y: 2, z: 3 },
            { i: 'quasar-9', n: 'Sirius B', d: 8.6, x: 1, y: 2, z: 3 },
          ],
        }
      if (u.endsWith('star-001.json'))
        return {
          ok: true,
          json: async () => [{ i: 'star-000002', n: 'Vega', d: 25, x: 0, y: 1, z: 2 }],
        }

      return { ok: false, status: 404 }
    })

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)

    // First shard resolves records — `!recs` false arm plus the
    // `_regRecords.get(kind) ?? []` empty-list arm.
    el._loadMoreRegistry('star')
    await flush(30)

    expect((el._regRecords.get('star') ?? []).length).toBe(3)

    // Second shard resolves too — `?? []` existing-list arm.
    el._loadMoreRegistry('star')
    await flush(30)

    expect((el._regRecords.get('star') ?? []).length).toBe(4)

    // Third shard 404s — the `!recs` early-return arm.
    el._loadMoreRegistry('star')
    await flush(10)

    // Fourth call — `loaded >= shards` early-return arm (manifest had 3).
    el._loadMoreRegistry('star')
    await flush(10)

    // A kind absent from the manifest — `kinds[kind]?.shards` nullish arm.
    el._loadMoreRegistry('dso')
    await flush(10)

    unmount(el)
  })

  test('hover on a registry id synthesizes the name without a catalog entry', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async (url) => {
      const u = String(url)

      if (u.endsWith('manifest.json'))
        return {
          ok: true,
          json: async () => ({
            total: 1,
            shardSize: 1000,
            kinds: { star: { count: 1, shards: ['star-000.json'] } },
          }),
        }
      if (u.endsWith('star-000.json'))
        return {
          ok: true,
          json: async () => [{ i: 'star-000000', n: 'Rigil', m: 0, d: 4.3, x: 1, y: 0, z: 0 }],
        }

      return { ok: false, status: 404 }
    })

    const el = mount()

    await waitFor(() => el._sfReady === true)

    // `de:` is a fresh dossier cache key — registry synth bypasses JSON.
    const store = (await import('@core/store.js')).default
    const spy = jest.spyOn(store.getters, 'getLang').mockReturnValue(LOCALES.DE)

    el._handleHover('star-000000')
    await flush(30)

    spy.mockRestore()

    // Registry ids carry no catalog distance — the label upgrades to the
    // bare synthesized name (`def ? … : name` arm + `_TIP_BY_ID ?? text`).
    const label = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_TIP_LABEL}`)

    expect(label.textContent).toBe('Rigil')

    unmount(el)
  })

  test('_matchesSearch filters by query across name, id and the empty arm', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    const el = mount()

    await waitFor(() => el._sfReady === true)

    const mars = { id: 'mars', name: 'Mars' }

    // Empty query passes everything — `!q` arm.
    el._search = ''

    expect(el._matchesSearch(mars)).toBe(true)

    // Name match short-circuits before the id check.
    el._search = 'mars'

    expect(el._matchesSearch(mars)).toBe(true)

    // Name misses → the id check arm runs.
    el._search = 'ars' // still matches the name
    expect(el._matchesSearch(mars)).toBe(true)

    el._search = 'x-'

    expect(el._matchesSearch({ id: 'x-1', name: 'X One' })).toBe(true)
    expect(el._matchesSearch(mars)).toBe(false)

    unmount(el)
  })

  test('the dossier panel renders media, sections and signature', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._selectedId = 'mars'
    el._dossier = {
      id: 'mars',
      name: 'Mars',
      kind: 'planet',
      tagline: 'The red planet',
      facts: [{ label: 'Distance', value: '225 Gm' }],
      history: 'Mapped by Mariner.',
      sections: [{ title: 'Geology', body: 'Basaltic crust.' }],
      media: {
        images: [
          { src: 'media/mars/img-1.jpg', caption: 'Valles', credit: 'NASA' },
          { src: 'media/mars/img-2.jpg' },
          { src: 'media/mars/img-3.jpg', caption: 'Caption only' },
          { src: 'https://cdn.invalid/m.jpg', credit: 'NASA' },
        ],
        videos: [
          {
            src: 'media/mars/video-1.mp4',
            poster: 'media/mars/poster.jpg',
            caption: 'Rotator',
            credit: 'NASA',
          },
          { src: 'media/mars/video-2.mp4' },
          { src: 'media/mars/video-3.mp4', caption: 'Caption only' },
        ],
        audio: [
          { src: 'media/mars/audio-1.mp3', caption: 'Wind' },
          { src: 'media/mars/audio-2.mp3', credit: 'NASA' },
          { src: 'media/mars/audio-3.mp3', caption: 'Caption only' },
        ],
      },
      meta: { acquired: '2024-01-01', translated: '2024-01-02' },
    }
    el._updateDom()

    const root = el.shadowRoot

    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_IMG}`).length).toBe(4)
    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_VIDEO}`).length).toBe(3)
    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_AUDIO}`).length).toBe(3)
    expect(root.querySelector(`.${SF_CLASSES.SF_PANEL_SEC_TITLE}`).textContent).toBe('Geology')
    expect(root.querySelector(`.${SF_CLASSES.SF_PANEL_SIG}`).textContent).toContain('2024-01-01')

    // Sparse media blocks — each `?? []` fallback arm.
    el._dossier = {
      id: 'mars',
      name: 'Mars',
      kind: 'planet',
      tagline: '',
      facts: [],
      history: '',
      media: { videos: [{ src: 'media/mars/v.mp4', caption: 'v' }] },
    }
    el._updateDom()

    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_VIDEO}`).length).toBe(1)
    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_IMG}`).length).toBe(0)

    el._dossier = {
      id: 'mars',
      name: 'Mars',
      kind: 'planet',
      tagline: '',
      facts: [],
      history: '',
      media: { images: [{ src: 'media/mars/i.jpg' }] },
    }
    el._updateDom()

    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_IMG}`).length).toBe(1)
    expect(root.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_AUDIO}`).length).toBe(0)

    // The media guard arms — no media block and an empty media block.
    el._dossier = { id: 'mars', name: 'Mars', kind: 'planet', tagline: '', facts: [], history: '' }
    el._updateDom()

    expect(root.querySelector(`.${SF_CLASSES.SF_MEDIA}`)).toBeNull()

    el._dossier = {
      id: 'mars',
      name: 'Mars',
      kind: 'planet',
      tagline: '',
      facts: [],
      history: '',
      media: {},
    }
    el._updateDom()

    expect(root.querySelector(`.${SF_CLASSES.SF_MEDIA}`)).toBeNull()

    unmount(el)
  })

  test('the search input feeds _setSearch and kind labels fall back raw', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    globalThis.fetch = jest.fn(async (url) => {
      const u = String(url)

      if (u.endsWith('manifest.json'))
        return {
          ok: true,
          json: async () => ({
            total: 1,
            shardSize: 1000,
            kinds: { star: { count: 1, shards: ['star-000.json'] } },
          }),
        }
      if (u.endsWith('star-000.json'))
        return {
          ok: true,
          json: async () => [
            { i: 'star-000000', n: 'Sirius', d: 8.6, x: 1, y: 2, z: 3 },
            // Unknown kind prefix — `t[kind] || kind` raw-fallback arm.
            { i: 'quasar-9', n: 'Sirius B', d: 8.6, x: 1, y: 2, z: 3 },
          ],
        }

      return { ok: false, status: 404 }
    })

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._navOpen = true
    el._ensureRegistry()
    await waitFor(() => el._regManifest !== null)
    await flush(20)

    // A falsy translated label falls back to the raw kind key.
    el.translations = { star: '' }
    el._updateDom()

    const headings = [...el.shadowRoot.querySelectorAll(`.${SF_CLASSES.SF_NAV_GROUP_TITLE}`)]

    expect(headings.some((h) => h.textContent.includes('star'))).toBe(true)

    // Restore default labels — the search rows then hit BOTH arms of
    // `t[kind] || kind` (star → truthy label, quasar → raw fallback).
    el.translations = {}

    // The search input drives _setSearch through onInput.
    const input = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_SEARCH}`)
    const spy = jest.spyOn(el, '_setSearch')

    input.value = 'sirius'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))

    expect(spy).toHaveBeenCalledWith('sirius')
    await flush(30)

    // A newer query issued before the older resolves — the stale arm of
    // the `.then` guard (`this._regQuery !== query`) drops the response.
    el._setSearch('sirius-stale')
    el._setSearch('sirius')
    await flush(30)

    expect(el._regQuery).toBe('sirius')
    expect(el._regSearching).toBe(false)

    unmount(el)
  })

  test('_updateDom carries the nav panel scroll offset across the rebuild', async () => {
    origFetch = globalThis.fetch
    origRoute = router.currentRoute
    origNavigate = router.handleNavigation

    const el = mount()

    await waitFor(() => el._sfReady === true)

    el._navOpen = true
    el._updateDom()

    const panel = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_PANEL}`)

    panel.scrollTop = 123

    // The rebuild swaps the element wholesale — the scroll offset must
    // survive so a selection never bounces the list back to its top.
    el._updateDom()

    const rebuilt = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_PANEL}`)

    expect(rebuilt).not.toBe(panel)
    expect(rebuilt.scrollTop).toBe(123)

    // scrollTop > 0 but the rebuilt tree lacks the panel — the
    // `if (panel)` guard arm.
    let calls = 0
    const origQuery = el.$

    el.$ = (sel) => {
      if (!String(sel).includes(SF_CLASSES.SF_NAV_PANEL)) return origQuery.call(el, sel)

      return ++calls === 1 ? { scrollTop: 7 } : null
    }
    el._updateDom()
    el.$ = origQuery

    unmount(el)
  })
})
