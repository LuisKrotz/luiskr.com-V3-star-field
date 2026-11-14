/**
 * @file star-print-wrapup-tails.test.js
 * @description Wrap-up coverage tails for star/print.tsx — seatBook's
 *   already-seated guard: a second printprepare inside one job (the
 *   gated dispatch plus an interleaved beforeprint announce, or a
 *   repeat event on the same committed DOM) must not seat a second
 *   volume — the section covers are the book's own marker, so the
 *   `document.querySelector(SECTION)` check bails the whole pass.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { bindPrintDossiers } from '../../../../star/print.js'
import { SF_CATALOG } from '../../../../engine/catalog.js'
import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { PRINT_CLASSES } from '@core/tokens/classes/print.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { TEST_TEXT } from '@tests/fixtures/test-constants.js'

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

describe('star print wrap-up tails', () => {
  test('a prepare on committed print DOM hits the seated-section guard instead of re-seating', () => {
    // A stale cover marker from an earlier compose — the guard's query.
    const seed = document.createElement(HTML_TAGS.DIV)

    seed.className = PRINT_CLASSES.SECTION

    document.body.appendChild(seed)

    // A resolved selection takes the sync excerpt arm — syncDossier
    // short-circuits on `_selectedId === id && _dossier`, so the guard
    // fires inside the dispatch itself (no async arm to await).
    const firstId = SF_CATALOG[0].id
    const dossier = { id: firstId, name: TEST_TEXT.HEADING, kind: 'star' }

    const unbind = bindPrintDossiers(host({ _selectedId: firstId, _dossier: dossier }))

    window.dispatchEvent(new Event(PRINT_EVENTS.PREPARE))

    // The guard returned before seating — the seed stays the only
    // section and no excerpt plate, toc, or cover joined it.
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.SECTION}`).length).toBe(1)
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.PLATE_DOSSIER}`).length).toBe(0)
    expect(document.body.querySelectorAll(`.${PRINT_CLASSES.TOC}`).length).toBe(0)

    unbind()
  })
})
