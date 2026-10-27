/**
 * @file star-schema-tails.test.js
 * @description Coverage tails for star/schema.ts — the runtime JSON-LD
 * parity emitters: emitStarIndexJsonLd (route guards, localized item
 * names, manifest → DataCatalog arm/fallback) and emitStarBodyJsonLd
 * (selection guards, dossier/names/id name resolution).
 */
import { describe, test, expect, afterEach } from '@jest/globals'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { SCHEMA_STRINGS } from '@core/tokens/strings/schema.js'
import router from '@core/router/router.js'
import { emitStarIndexJsonLd, emitStarBodyJsonLd } from '../../../../star/schema.js'
import { generateProjectSchema } from '@core/utils/schema.js'
import { TEST_PROJECTS, TEST_TEXT } from '@tests/fixtures/test-constants.js'

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms))

const graphPayload = () => {
  const el = document.getElementById(SCHEMA_STRINGS.JSON_LD_SCRIPT_ID)

  return el ? JSON.parse(el.textContent) : null
}

const SF_ROUTE = (over = {}) => ({
  view: VIEW_TAGS.VIEW_STAR_FIELD,
  path: '/star-field-experiment',
  meta: { title: 'Luis Krötz | Star Field' },
  params: {},
  ...over,
})

const MANIFEST = {
  total: 8,
  shardSize: 1000,
  kinds: {
    star: { count: 5, shards: ['star-000.json'] },
    exoplanet: { count: 2, shards: ['exoplanet-000.json'] },
    dso: { count: 1, shards: [] },
  },
}

const view = (over = {}) => ({
  _names: null,
  translations: null,
  _selectedId: null,
  _baseStarPath: () => '/star-field-experiment',
  ...over,
})

let origRoute
let origFetch

afterEach(() => {
  router.currentRoute = origRoute
  globalThis.fetch = origFetch
  document.getElementById(SCHEMA_STRINGS.JSON_LD_SCRIPT_ID)?.remove()
})

describe('star schema runtime emitters', () => {
  // The registry manifest caches module-level on success — the failed
  // fetch isn't cached, so this arm must run before the success arms.
  test('index emit drops the catalog arm when the manifest fails', async () => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch

    globalThis.fetch = async () => ({ ok: false })

    router.currentRoute = SF_ROUTE()

    emitStarIndexJsonLd(view())

    await flush(60)

    const payload = graphPayload()

    expect(payload['@graph'].some((e) => e['@type'] === 'DataCatalog')).toBe(false)
    expect(payload['@graph'].some((e) => e['@type'] === 'ItemList')).toBe(true)
  })

  test('index emit guards: wrong view and body-param routes return early', async () => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch

    globalThis.fetch = async () => ({ ok: true, json: async () => MANIFEST })

    router.currentRoute = { view: 'view-other', meta: {}, params: {} }
    emitStarIndexJsonLd(view())

    router.currentRoute = SF_ROUTE({ params: { body: 'mars' } })
    emitStarIndexJsonLd(view())

    await flush()

    expect(graphPayload()).toBeNull()
  })

  test('index emit writes ItemList + DataCatalog once the manifest lands', async () => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch

    globalThis.fetch = async () => ({ ok: true, json: async () => MANIFEST })

    router.currentRoute = SF_ROUTE()

    const c = view({
      _names: { byId: new Map([['mars', 'Marte']]) },
      translations: {
        catalog: 'Catálogo',
        registry_star: 'Estrellas',
        registry_star_about: 'about stars',
      },
    })

    emitStarIndexJsonLd(c)

    await flush(60)

    const payload = graphPayload()
    const list = payload['@graph'].find((e) => e['@type'] === 'ItemList')
    const mars = list.itemListElement.find((i) => i.url.endsWith('/mars'))

    expect(mars.name).toBe('Marte')

    const cat = payload['@graph'].find((e) => e['@type'] === 'DataCatalog')

    expect(cat.name).toBe('Catálogo')
    expect(cat.dataset).toHaveLength(4)
    expect(cat.dataset[0].name).toBe('Estrellas')
    expect(cat.dataset[0].distribution.length).toBe(2)
    expect(cat.dataset[2].distribution.length).toBe(1)
    expect(cat.dataset[3].distribution[0].contentUrl).toContain('deep-field.bin')
  })

  test('index emit without names/catalog label falls back to authored names', async () => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch

    globalThis.fetch = async () => ({ ok: true, json: async () => MANIFEST })

    router.currentRoute = SF_ROUTE({ meta: { title: 'Star Field | Luis Krötz' } })

    emitStarIndexJsonLd(view({ translations: {} }))

    await flush(60)

    const payload = graphPayload()
    const cat = payload['@graph'].find((e) => e['@type'] === 'DataCatalog')

    expect(cat.name).toBe('Star Field')
    expect(cat.dataset[0].name).toBe('star')
    expect(cat.dataset[0].description).toBeUndefined()
  })

  test('index emit drops the write when the route moves to a body mid-fetch', async () => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch

    globalThis.fetch = async () => ({ ok: true, json: async () => MANIFEST })

    router.currentRoute = SF_ROUTE()

    emitStarIndexJsonLd(view())

    router.currentRoute = SF_ROUTE({ params: { body: 'mars' } })

    await flush(60)

    expect(graphPayload()?.['@graph']?.some((e) => e['@type'] === 'DataCatalog') ?? false).toBe(
      false
    )
  })

  test('body emit guards: wrong view and stale selection return early', () => {
    origRoute = router.currentRoute

    router.currentRoute = { view: 'view-other', meta: {}, params: {} }
    emitStarBodyJsonLd(view({ _selectedId: 'mars' }), 'mars', { name: 'Mars' })

    router.currentRoute = SF_ROUTE({ params: { body: 'mars' } })
    emitStarBodyJsonLd(view({ _selectedId: 'venus' }), 'mars', { name: 'Mars' })

    expect(graphPayload()).toBeNull()
  })

  test('body emit writes Article/Thing from the resolved dossier', () => {
    origRoute = router.currentRoute

    router.currentRoute = SF_ROUTE({ params: { body: 'mars' } })

    emitStarBodyJsonLd(
      view({ _selectedId: 'mars', translations: { title: 'Star Field' } }),
      'mars',
      {
        name: 'Mars',
        tagline: 'red planet',
        facts: [{ label: 'Moons', value: '2' }],
      }
    )

    const article = graphPayload()['@graph'].find((e) => e['@type'] === 'Article')

    expect(article.headline).toBe('Mars')
    expect(article.about.additionalProperty).toHaveLength(1)
    expect(article.isPartOf['@id']).toBe('https://luiskr.com/star-field-experiment#webpage')
  })

  test('body emit falls back through names table then raw id', () => {
    origRoute = router.currentRoute

    router.currentRoute = SF_ROUTE({ params: { body: 'mars' }, meta: { title: 'Star Field' } })

    const c = view({
      _selectedId: 'mars',
      _names: { byId: new Map([['mars', 'Marte']]) },
    })

    emitStarBodyJsonLd(c, 'mars', null)

    expect(graphPayload()['@graph'].find((e) => e['@type'] === 'Article').headline).toBe('Marte')

    const c2 = view({ _selectedId: 'vesta' })

    emitStarBodyJsonLd(c2, 'vesta', null)

    expect(graphPayload()['@graph'].find((e) => e['@type'] === 'Article').headline).toBe('vesta')
  })

  // generateProjectSchema's early-return arms ride this file's schema.ts
  // instance — the core-suite copies land on a different (unserialized)
  // instance, so the null/empty-slug guards are exercised here instead.
  test('project schema returns an empty graph for missing inputs', () => {
    expect(generateProjectSchema(null, TEST_PROJECTS.CICB)).toEqual([])
    expect(generateProjectSchema({ title: TEST_TEXT.HEADING }, '')).toEqual([])
  })

  test('missing meta title falls back to the base page name', async () => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch

    globalThis.fetch = async () => ({ ok: true, json: async () => MANIFEST })

    router.currentRoute = SF_ROUTE({ meta: {} })

    emitStarIndexJsonLd(view())

    await flush()

    const graph = graphPayload()

    expect(graph).not.toBeNull()
    expect(graph['@graph'].find((e) => e['@type'] === 'WebPage').name).toBe('Luis Krötz')
  })
})
