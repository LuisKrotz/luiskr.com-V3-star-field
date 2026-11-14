/**
 * @file starfield/star-print.test.js
 * @description Print book composition — the `printprepare` listener seats
 *   the whole catalog as a book at <body> level: a contents leaf, one
 *   face-page section cover per region group, a dossier plate per body,
 *   and the deep-catalog part's cover + synthesized index plate. A
 *   selected body prints as a one-sheet excerpt under its own group's
 *   cover. Fetch is stubbed per test; the dossier/manifest caches
 *   persist for the file, so the sync arm runs on the warm second pass.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { bindPrintDossiers } from '../../star/print.js'
import { SF_CATALOG, SF_GROUP_ORDER, sfCatalogByGroup } from '../../engine/catalog.js'
import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { PRINT_CLASSES } from '@core/tokens/classes/print.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { FALLBACK_PAGES } from '@core/locale/fallback.js'
import { TRANSLATION_KEYS } from '@core/tokens/routes/translation-keys.js'
import { TEST_TEXT } from '@tests/fixtures/test-constants.js'

/** Real English labels the compose reads — the fallback mock serves the
 *  database snapshot's star-field node, same as the component tests. */
const T = FALLBACK_PAGES[TRANSLATION_KEYS.STAR_FIELD]

/** fetch-Response stub — ok:true with an async json() returning the body. */
const jsonRes = (body) => ({ ok: true, json: async () => body })

/** Catalog manifest fixture — the three registry kinds the index plate counts. */
const manifest = {
  total: 5,
  shardSize: 1000,
  kinds: {
    star: { count: 3, shards: ['star-000.json'] },
    exoplanet: { count: 1, shards: ['exoplanet-000.json'] },
    dso: { count: 1, shards: ['dso-000.json'] },
  },
}

/** Star-shard payload — the synthesized registry dossier source rows. */
const starShard = [
  { i: 'star-000000', n: 'Sol', m: -26.7, d: 0, s: 'G2V', x: 0, y: 0, z: 0 },
  { i: 'star-000001', n: 'Sirius', m: -1.4, d: 8.6, s: 'A1V', c: 'CMa', x: -5, y: -6, z: -1 },
]

/** Dossier fixture — one full-shaped payload per catalog id. */
const dossierFor = (id) => ({
  id,
  name: `Body ${id}`,
  kind: 'planet',
  tagline: TEST_TEXT.BODY,
  facts: [{ label: TEST_TEXT.HEADING, value: TEST_TEXT.BODY }],
  history: TEST_TEXT.BODY,
  sections: [{ title: TEST_TEXT.HEADING, body: TEST_TEXT.BODY }],
  media: {
    images: [{ src: `${id}.png`, caption: TEST_TEXT.BODY, credit: TEST_TEXT.BODY }],
  },
  source: TEST_TEXT.BODY,
  meta: { acquired: '2026-01-01', translated: '2026-01-01', locale: 'en' },
})

/** fetch mock — manifest + star shard + a generic dossier per /data/en/*.json. */
const bookFetch = () =>
  jest.fn(async (url) => {
    const u = String(url)

    if (u.endsWith('/manifest.json')) return jsonRes(manifest)

    if (u.includes('/index/')) return jsonRes(starShard)

    const m = u.match(/\/data\/en\/([^/]+)\.json$/)

    if (m) return jsonRes(dossierFor(decodeURIComponent(m[1])))

    return { ok: false, status: 404 }
  })

/** Minimal live-host stub — the fields the compose reads off StarField. */
const host = (over = {}) => ({
  isConnected: true,
  _selectedId: null,
  _dossier: null,
  _names: { byId: new Map(), bySlug: new Map() },
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

let origFetch

beforeEach(() => {
  origFetch = globalThis.fetch
  globalThis.fetch = bookFetch()
})

afterEach(() => {
  globalThis.fetch = origFetch
  clearSeated()
})

describe('star print book', () => {
  test('composes the full book — contents, one cover per group plus the deep catalog, and a dossier per body', async () => {
    const unbind = bindPrintDossiers(host())

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    const groupTotal = [...sfCatalogByGroup().values()].reduce((n, defs) => n + defs.length, 0)

    // 145 body dossiers + the deep-catalog index plate.
    await waitFor(
      () =>
        document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`).length === groupTotal + 1
    )

    const covers = document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`)

    // Six region groups in catalog order + the deep catalog closing.
    expect(covers.length).toBe(SF_GROUP_ORDER.length + 1)

    const coverTitles = [...covers].map(
      (c) => c.querySelector(`.${PRINT_CLASSES.SECTION_TITLE}`)?.textContent
    )

    expect(coverTitles).toEqual([...SF_GROUP_ORDER.map((k) => T[k]), T.catalog])

    // The contents leaf seats before every section cover and lists each
    // part plus every body's name under it.
    const nodes = seated()
    const toc = document.body.querySelector(`.${PRINT_CLASSES.TOC}`)

    expect(toc).toBeTruthy()
    expect(nodes.indexOf(toc)).toBe(0)
    expect(toc.querySelectorAll(`.${PRINT_CLASSES.TOC_ITEM}`).length).toBe(
      SF_GROUP_ORDER.length + 1
    )
    expect(toc.querySelectorAll(`.${PRINT_CLASSES.TOC_ITEM_SUB}`).length).toBe(groupTotal)

    // Every dossier plate carries its editorial furniture — header h2,
    // provenance footer, and the route QR.
    const first = document.body.querySelector(`.${PRINT_CLASSES.PLATE_DOSSIER}`)

    expect(first.querySelector(`${HTML_TAGS.H2}`)).toBeTruthy()
    expect(first.querySelector(`${HTML_TAGS.FOOTER} .${SF_CLASSES.SF_PANEL_SOURCE}`)).toBeTruthy()
    expect(first.querySelector(`.${PRINT_CLASSES.QR_LINK}`)).toBeTruthy()

    // The deep-catalog index plate closes the run — kind counts from the
    // manifest plus the three catalogues' prose and provenance.
    const plates = document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`)
    const index = plates[plates.length - 1]

    expect(index.querySelector(`.${SF_CLASSES.SF_FACTS}`)).toBeTruthy()
    expect(index.querySelectorAll(`.${SF_CLASSES.SF_PANEL_SEC}`).length).toBe(3)
    expect(index.querySelector(`.${SF_CLASSES.SF_PANEL_SIG}`)).toBeTruthy()

    unbind()
  })

  test('sync arm seats the same book immediately once the dossier cache is warm', () => {
    const unbind = bindPrintDossiers(host())

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    // Warmed by the first test's compose — every node seats inside the
    // dispatch itself, no await needed.
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(
      SF_GROUP_ORDER.length + 1
    )
    expect(document.body.querySelector(`.${PRINT_CLASSES.TOC}`)).toBeTruthy()

    unbind()
  })

  test('a selected body prints as a one-sheet excerpt under its group cover — no contents, no deep catalog', async () => {
    const id = SF_CATALOG[0].id

    const unbind = bindPrintDossiers(host({ _selectedId: id, _dossier: dossierFor(id) }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`).length).toBe(1)
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(1)
    expect(document.body.querySelector(`.${PRINT_CLASSES.TOC}`)).toBeNull()

    // The excerpt cover carries the selected body's own group title.
    const def = SF_CATALOG[0]

    expect(document.body.querySelector(`.${PRINT_CLASSES.SECTION_TITLE}`)?.textContent).toBe(
      T[def.group]
    )

    unbind()
  })

  test('a selected registry record composes its excerpt through the async arm', async () => {
    const unbind = bindPrintDossiers(host({ _selectedId: 'star-000000' }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    await waitFor(
      () => document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`).length === 1
    )

    // The synth dossier's name comes from the shard record, not the id.
    expect(
      document.body.querySelector(`.${PRINT_CLASSES.PLATE_DOSSIER} ${HTML_TAGS.H2}`)?.textContent
    ).toBe('Sol')

    // Registry records own no catalog group — the cover falls back to
    // the kind label.
    expect(document.body.querySelector(`.${PRINT_CLASSES.SECTION_TITLE}`)?.textContent).toBe(T.star)

    unbind()
  })

  test('a disconnected host composes nothing and the unbinder removes the listener', async () => {
    const unbind = bindPrintDossiers(host({ isConnected: false }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    expect(seated().length).toBe(0)

    unbind()

    const live = bindPrintDossiers(host())

    live()

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    // With every listener gone, a dispatch seats nothing new — give the
    // async arm a beat to prove it never ran.
    await new Promise((r) => setTimeout(r, 60))

    expect(seated().length).toBe(0)
  })
})
