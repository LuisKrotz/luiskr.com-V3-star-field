/**
 * @file coverage/starfield/star/star-print-tails.test.js
 * @description Coverage tails for star/print.tsx — the arms the
 *   happy-path suite never reaches: sparse translations driving every
 *   `?? fallback` site (raw group keys, raw kind/registry labels,
 *   blank records/catalog/source/acquired words), the null-manifest
 *   index plate (404), the partial-manifest `kinds[kind]?.count ?? 0`
 *   arms, bare dossiers without tagline/history/media/source (falsy
 *   furniture + `media?.`/`?? []` arms), the gallery caption/credit/
 *   poster matrix, a `byId` names-table hit, `decode?.()`'s missing-
 *   decode arm plus its rejection sink, the no-requestIdleCallback
 *   warm arm, `translations ?? {}`, an over-capacity QR payload
 *   (qrSvg null), the registry excerpt's group-less title fallback,
 *   and a null-resolving excerpt.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { bindPrintDossiers } from '../../../../star/print.js'
import { ensureRegistryManifest } from '../../../../engine/registry.js'
import { SF_CATALOG, SF_GROUP_ORDER } from '../../../../engine/catalog.js'
import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { PRINT_CLASSES } from '@core/tokens/classes/print.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { TEST_TEXT } from '@tests/fixtures/test-constants.js'

/** fetch-Response stub — ok:true with an async json() returning the body. */
const jsonRes = (body) => ({ ok: true, json: async () => body })

/** Registry kinds in seat order — index-plate fixture keys. */
const REG_KINDS = ['star', 'exoplanet', 'dso']

/** Translations map with EVERY label key the compose reads set to
 *  undefined — the merge spreads it over the English snapshot, so each
 *  `t[key] ?? fallback` arm fires its raw fallback instead of a label. */
const SPARSE_T = {
  solar: undefined,
  milkyWay: undefined,
  nebulae: undefined,
  galaxies: undefined,
  localGroup: undefined,
  hierarchy: undefined,
  catalog: undefined,
  records: undefined,
  source: undefined,
  acquired: undefined,
  planet: undefined,
  star: undefined,
  exoplanet: undefined,
  dso: undefined,
  registry_star: undefined,
  registry_star_about: undefined,
  registry_exoplanet: undefined,
  registry_exoplanet_about: undefined,
  registry_dso: undefined,
  registry_dso_about: undefined,
}

/** Bare dossier — no tagline/history/sections/media/source/meta and an
 *  empty kind (falsy furniture + `media?.`/`?? []`/`kindLabel ?` arms). */
const BARE = (id) => ({
  id,
  name: `Bare ${id}`,
  kind: '',
  facts: [{ label: TEST_TEXT.HEADING, value: TEST_TEXT.BODY }],
})

/** Rich dossier — full furniture plus a media matrix covering every
 *  caption/credit arm and poster/no-poster video arms. */
const RICH = (id) => ({
  id,
  name: `Rich ${id}`,
  kind: 'quasar',
  tagline: TEST_TEXT.BODY,
  facts: [{ label: TEST_TEXT.HEADING, value: TEST_TEXT.BODY }],
  history: TEST_TEXT.BODY,
  sections: [{ title: TEST_TEXT.HEADING, body: TEST_TEXT.BODY }],
  media: {
    images: [
      { src: `${id}-a.png` },
      { src: `${id}-b.png`, caption: TEST_TEXT.BODY },
      { src: `${id}-c.png`, caption: TEST_TEXT.BODY, credit: TEST_TEXT.BODY },
    ],
    videos: [
      { src: `${id}-v.mp4`, poster: `${id}-p.png`, caption: TEST_TEXT.BODY },
      { src: `${id}-w.mp4` },
    ],
  },
  source: TEST_TEXT.BODY,
  meta: { acquired: '2026-01-01', translated: '2026-01-01', locale: 'en' },
})

/** Hierarchy-group ids — those dossiers serve the bare fixture. */
const BARE_IDS = new Set(['interstellar-neighborhood', 'observable-universe'])

/** Star-shard payload — the registry excerpt's synthesized dossier row. */
const starShard = [{ i: 'star-000000', n: 'Sol', m: -26.7, d: 0, s: 'G2V', x: 0, y: 0, z: 0 }]

/** Route table — tests rewrite entries per dispatch. */
const routes = {
  manifest: { ok: false, status: 404 },
  dossier: (id) =>
    id === 'no-such-body'
      ? { ok: false, status: 404 }
      : jsonRes(BARE_IDS.has(id) ? BARE(id) : RICH(id)),
}

/** fetch mock — manifest + registry shard + a per-id dossier route. */
const tailsFetch = () =>
  jest.fn(async (url) => {
    const u = String(url)

    if (u.endsWith('/manifest.json')) {
      return typeof routes.manifest === 'function' ? routes.manifest() : routes.manifest
    }

    if (u.includes('/index/')) return jsonRes(starShard)

    const m = u.match(/\/data\/en\/([^/]+)\.json$/)

    if (m) return routes.dossier(decodeURIComponent(m[1]))

    return { ok: false, status: 404 }
  })

/** Minimal live-host stub — the fields the compose reads off StarField. */
const host = (over = {}) => ({
  isConnected: true,
  _selectedId: null,
  _dossier: null,
  _names: null,
  _namesReady: Promise.resolve(),
  _baseStarPath: () => '/star',
  _slugForId: (id) => id,
  translations: {},
  ...over,
})

/** Injected book nodes still seated at body level, in document order. */
const seated = () =>
  [...document.body.children].filter(
    (el) =>
      el.classList?.contains(PRINT_CLASSES.SECTION) ||
      el.classList?.contains(PRINT_CLASSES.PLATE_DOSSIER) ||
      el.classList?.contains(PRINT_CLASSES.TOC)
  )

/** Poll-until-true wait — async seats land at unbounded microtask times. */
const waitFor = (pred, timeout = 10000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      if (pred()) return resolve()
      if (Date.now() - t0 > timeout) return reject(new Error('waitFor timeout'))

      setTimeout(tick, 30)
    }
    tick()
  })

/** Removes every injected book node — copies persist across tests otherwise. */
const clearSeated = () => {
  for (const el of seated()) el.remove()
}

/** Live unbinders — a mid-test assertion failure must not leak its
 *  PREPARE listener into the next dispatch (stale listeners re-seat a
 *  whole book on top of the test's own). */
const pending = []

/** Binds and registers the unbinder for the afterEach drain. */
const bind = (h) => {
  const unbind = bindPrintDossiers(h)

  pending.push(unbind)

  return unbind
}

let origFetch
let origRic
let origDecode

beforeEach(() => {
  origFetch = globalThis.fetch
  origRic = window.requestIdleCallback
  origDecode = Object.getPrototypeOf(document.createElement(HTML_TAGS.IMG)).decode
  globalThis.fetch = tailsFetch()
})

afterEach(() => {
  globalThis.fetch = origFetch
  window.requestIdleCallback = origRic
  Object.getPrototypeOf(document.createElement(HTML_TAGS.IMG)).decode = origDecode

  while (pending.length) pending.pop()()

  clearSeated()
})

describe('star print tails', () => {
  test('sparse translations drive every `?? fallback` arm and the null manifest seats the count-less index', async () => {
    const unbind = bind(host({ translations: SPARSE_T }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    await waitFor(
      () =>
        document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length ===
        SF_GROUP_ORDER.length + 1
    )

    const covers = document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`)

    // Sparse labels → raw group keys on the covers; the catalog cover's
    // title + count are both blank (t.catalog undefined, manifest 404).
    const titles = [...covers].map(
      (c) => c.querySelector(`.${PRINT_CLASSES.SECTION_TITLE}`)?.textContent
    )

    expect(titles).toEqual([...SF_GROUP_ORDER, ''])

    // The index plate carries no facts dl while the manifest is null,
    // and the registry section titles fall back to the raw kind tokens.
    const plates = document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`)
    const index = plates[plates.length - 1]

    expect(index.querySelector(`.${SF_CLASSES.SF_FACTS}`)).toBeNull()
    expect(
      [...index.querySelectorAll(`.${SF_CLASSES.SF_PANEL_SEC_TITLE}`)].map((h) => h.textContent)
    ).toEqual(REG_KINDS)

    // A bare dossier plate — no kind tag, tagline, history, figures, or
    // provenance furniture (every falsy arm in one fixture).
    const barePlate = [...plates].find(
      (p) => p.querySelector(HTML_TAGS.H2)?.textContent === 'Bare observable-universe'
    )

    expect(barePlate.querySelector(`.${SF_CLASSES.SF_PANEL_TAG}`)).toBeNull()
    expect(barePlate.querySelector(`.${SF_CLASSES.SF_PANEL_TAGLINE}`)).toBeNull()
    expect(barePlate.querySelector(`.${SF_CLASSES.SF_PANEL_HISTORY}`)).toBeNull()
    expect(barePlate.querySelector(`.${SF_CLASSES.SF_MEDIA_FIG}`)).toBeNull()
    expect(barePlate.querySelector(`.${SF_CLASSES.SF_PANEL_SOURCE}`)).toBeNull()

    // A rich plate — kind falls back to the raw 'quasar' label; the
    // gallery seats images + the poster-mapped video still.
    const richPlate = [...plates].find((p) =>
      p.querySelector(HTML_TAGS.H2)?.textContent?.startsWith('Rich ')
    )

    expect(richPlate.querySelector(`.${SF_CLASSES.SF_PANEL_TAG}`)?.textContent).toBe('quasar')
    expect(richPlate.querySelectorAll(`.${SF_CLASSES.SF_MEDIA_FIG}`).length).toBe(4)

    unbind()
  })

  test('the warm sync arm reads the names table and re-runs the sparse fallback sites', () => {
    const firstId = SF_CATALOG[0].id

    const unbind = bind(
      host({
        translations: SPARSE_T,
        _names: { byId: new Map([[firstId, TEST_TEXT.HEADING]]), bySlug: new Map() },
      })
    )

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    // Every dossier resolved in the first test — the whole book seats
    // inside the dispatch (bookPartsSync's own `t[key] ?? key` site).
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(
      SF_GROUP_ORDER.length + 1
    )

    // The byId hit seats the localized name; misses fall back to the
    // dossier's own name — both `??` arms in the contents leaf.
    const subs = document.body.querySelectorAll(`.${PRINT_CLASSES.TOC_ITEM_SUB}`)

    expect([...subs].some((s) => s.textContent.includes(TEST_TEXT.HEADING))).toBe(true)
    expect([...subs].some((s) => s.textContent.includes(`Rich ${SF_CATALOG[1].id}`))).toBe(true)

    unbind()
  })

  test('a partial manifest exercises the `kinds[kind]?.count ?? 0` arms', async () => {
    routes.manifest = () =>
      jsonRes({
        total: 4,
        shardSize: 1000,
        kinds: { star: { count: 3, shards: ['star-000.json'] } },
      })

    // The T1 404 wasn't cached — this re-fetches and lands the mirror.
    expect(await ensureRegistryManifest()).toBeTruthy()

    // Sparse labels here too — the facts dl only renders when a
    // manifest landed, so its `t[kind] ?? kind` arm needs this dispatch.
    const unbind = bind(host({ translations: SPARSE_T }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    const plates = document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`)
    const index = plates[plates.length - 1]

    // kinds present → facts seat; exoplanet/dso rows hit the `?? 0` arm.
    expect(index.querySelectorAll(`.${SF_CLASSES.SF_FACT}`).length).toBe(REG_KINDS.length)
    expect(
      [...index.querySelectorAll(`.${SF_CLASSES.SF_FACT_VAL}`)].map((d) => d.textContent)
    ).toEqual(['3', '0', '0'])

    // The catalog cover's count line shows now that a manifest landed.
    const covers = document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`)
    const catCover = covers[covers.length - 1]

    expect(catCover.querySelector(`.${PRINT_CLASSES.SECTION_COUNT}`)).toBeTruthy()

    unbind()
  })

  test('the no-rIC warm arm, `translations ?? {}`, missing `decode`, and over-capacity QR all seat a complete book', async () => {
    delete window.requestIdleCallback

    const imgProto = Object.getPrototypeOf(document.createElement(HTML_TAGS.IMG))

    imgProto.decode = undefined

    const unbind = bind(
      host({
        translations: undefined,
        _baseStarPath: () => `/${TEST_TEXT.LONG_NOTE.repeat(30)}`,
      })
    )

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    // The book still seats — the decode skip arm yields no pending
    // decodes and plates carry no QR link (v40 overflow → null).
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(
      SF_GROUP_ORDER.length + 1
    )
    expect(document.body.querySelector(`.${PRINT_CLASSES.QR_LINK}`)).toBeNull()

    unbind()

    clearSeated()

    // The decode() call arm plus its rejection sink — a rejecting
    // decode routes through `.catch(() => undefined)`.
    imgProto.decode = () => Promise.reject(new Error('decode fail'))

    const unbind2 = bind(host({ _baseStarPath: () => '/s' }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(
      SF_GROUP_ORDER.length + 1
    )

    // Let the rejection sink drain before the next test's dispatch.
    await new Promise((r) => setTimeout(r, 30))

    unbind2()
  })

  test('a registry-record excerpt takes the group-less `?? dossier.kind` title arm, and a null-resolving excerpt seats nothing', async () => {
    // 'star-000000' owns no catalog def — the cover title falls through
    // `t[dossier.kind]`, and the sparse map takes its own `??` arm.
    const unbind = bind(host({ _selectedId: 'star-000000', translations: SPARSE_T }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    await waitFor(
      () => document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`).length === 1
    )

    expect(document.body.querySelector(`.${PRINT_CLASSES.SECTION_TITLE}`)?.textContent).toBe('star')

    unbind()

    clearSeated()

    // A selection that resolves null seats nothing — the `[]` arm.
    const unbind2 = bind(host({ _selectedId: 'no-such-body' }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    await new Promise((r) => setTimeout(r, 80))

    expect(seated().length).toBe(0)

    unbind2()
  })
})
