/**
 * @file coverage/starfield/star/star-print-group-tails.test.js
 * @description Coverage tails for star/print.tsx — the empty-catalog
 *   arms: a group order entry with no backing map entry exercises
 *   `groups.get(key) ?? []`, the `if (dossiers.length)` group-drop
 *   guard on BOTH part builders, and bookPartsSync's `parts.length ?
 *   parts : null` bail to the async arm. The catalog module is mocked
 *   so an order entry can exist without a group map entry — the same
 *   technique the render tails use.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { SF_GROUPS } from '@core/tokens/starfield/kinds.js'
import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { PRINT_CLASSES } from '@core/tokens/classes/print.js'

jest.unstable_mockModule('../../../../engine/catalog.js', () => ({
  SF_CATALOG: [],
  SF_GROUP_ORDER: [SF_GROUPS.SOLAR],
  sfCatalogByGroup: () => new Map(),
}))

const { bindPrintDossiers } = await import('../../../../star/print.js')

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

/** Poll-until-true wait — the async arm seats on unbounded microtasks. */
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

let origFetch

beforeEach(() => {
  origFetch = globalThis.fetch
  globalThis.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
})

afterEach(() => {
  globalThis.fetch = origFetch

  for (const el of document.body.querySelectorAll(
    `.${PRINT_CLASSES.SECTION}, .${PRINT_CLASSES.PLATE_DOSSIER}, .${PRINT_CLASSES.TOC}`
  )) {
    el.remove()
  }
})

describe('star print group tails', () => {
  test('an order entry without a map group drops the section and falls back to the async arm', async () => {
    const unbind = bindPrintDossiers(host())

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    // The empty `solar` group pushes nothing — the book closes on the
    // contents leaf, the deep-catalog cover, and its index plate alone.
    await waitFor(
      () => document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`).length === 1
    )

    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(1)
    expect(document.body.querySelector(`.${PRINT_CLASSES.TOC}`)).toBeTruthy()

    unbind()
  })
})
