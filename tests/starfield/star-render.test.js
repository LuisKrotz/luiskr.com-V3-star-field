/**
 * @file starfield/star-render.test.js
 * @description renderStarField branch coverage — loader shown/hidden, CSS
 * fallback surface, drawer open/closed, dossier panel states (empty,
 * loading, loaded, unknown kind), action buttons and the translated
 * group titles.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { renderStarField } from '../../star/render.js'

const mount = (host) => {
  const node = renderStarField(host)
  const div = document.createElement('div')

  div.appendChild(node)

  return div
}

const makeHost = (overrides = {}) => ({
  _sfReady: true,
  _sfFailed: false,
  _navOpen: false,
  _selectedId: null,
  _dossier: null,
  _dossierLoading: false,
  _liveText: '',
  translations: null,
  _search: '',
  _matchesSearch: () => true,
  _regManifest: null,
  _regLoaded: new Map(),
  _regRecords: new Map(),
  _regSearch: null,
  _regSearching: false,
  _loadMoreRegistry: jest.fn(),
  _setSearch: jest.fn(),
  _hintBody: jest.fn(),
  _clearHint: jest.fn(),
  _toggleNav: jest.fn(),
  _selectBody: jest.fn(),
  _closePanel: jest.fn(),
  _takeScreenshot: jest.fn(),
  _flyHome: jest.fn(),
  _instructionsOpen: false,
  _toggleInstructions: jest.fn(),
  _closeInstructions: jest.fn(),
  ...overrides,
})

describe('star render', () => {
  test('shows the loader until ready and the fallback on failure', () => {
    const booting = mount(makeHost({ _sfReady: false }))

    expect(booting.querySelector(`.${SF_CLASSES.SF_LOADER}`)).toBeTruthy()
    expect(booting.querySelector(`.${SF_CLASSES.SF_FALLBACK}`)).toBeNull()

    const failed = mount(makeHost({ _sfFailed: true }))

    expect(failed.querySelector(`.${SF_CLASSES.SF_FALLBACK}`)).toBeTruthy()
    expect(failed.querySelector(`.${SF_CLASSES.SF_LOADER}`)).toBeNull()

    const ready = mount(makeHost())

    expect(ready.querySelector(`.${SF_CLASSES.SF_LOADER}`)).toBeNull()
  })

  test('drawer aria state and group titles follow the translation node', () => {
    const host = makeHost({
      _navOpen: true,
      translations: { explore: 'Carta', solar: 'Solsystem' },
    })
    const root = mount(host)
    const toggle = root.querySelector(`.${SF_CLASSES.SF_NAV_TOGGLE}`)

    expect(toggle.getAttribute(ARIA_ATTRS.ARIA_EXPANDED)).toBe('true')
    expect(root.querySelector(`.${SF_CLASSES.SF_NAV}`).className).toContain(SF_CLASSES.SF_NAV_OPEN)

    const titles = [...root.querySelectorAll(`.${SF_CLASSES.SF_NAV_GROUP_TITLE}`)].map(
      (n) => n.textContent
    )

    expect(titles).toContain('Solsystem')

    toggle.click()

    expect(host._toggleNav).toHaveBeenCalled()

    // In-drawer close button also routes to _toggleNav.
    root.querySelector(`.${SF_CLASSES.SF_NAV_CLOSE}`).click()

    expect(host._toggleNav).toHaveBeenCalledTimes(2)
  })

  test('every catalogued object is a heading — h4 under the h3 group titles', () => {
    const host = makeHost({ _navOpen: true })
    const root = mount(host)

    // Catalog body rows: h4 heading wrapping the button, under the h3 group.
    const itemHeads = [...root.querySelectorAll(`h4.${SF_CLASSES.SF_NAV_ITEM_HEADING}`)]

    expect(itemHeads.length).toBeGreaterThan(0)
    expect(
      itemHeads.every(
        (hEl) =>
          hEl.querySelector(`button.${SF_CLASSES.SF_NAV_ITEM}`) && hEl.textContent.trim().length > 0
      )
    ).toBe(true)

    // The sun row (id 'sun') is a named heading.
    const sunHead = itemHeads.find((hEl) => hEl.querySelector('[data-body="sun"]'))

    expect(sunHead).toBeTruthy()
    expect(sunHead.textContent).toContain('Sun')
  })

  test('nav body buttons route clicks to _selectBody', () => {
    const host = makeHost({ _navOpen: true })
    const root = mount(host)
    const btn = root.querySelector(`.${SF_CLASSES.SF_NAV_ITEM}`)

    btn.click()

    expect(host._selectBody).toHaveBeenCalledWith('sun')

    const host2 = makeHost({ _navOpen: true, _selectedId: 'sun' })
    const root2 = mount(host2)

    expect(root2.querySelector(`.${SF_CLASSES.SF_NAV_ITEM}`).className).toContain(
      SF_CLASSES.SF_NAV_ITEM_ACTIVE
    )
  })

  test('panel renders loading, dossier content, and unknown-kind tag', () => {
    const loading = mount(makeHost({ _selectedId: 'mars', _dossierLoading: true }))

    expect(loading.querySelector(`.${SF_CLASSES.SF_PANEL}`).className).toContain(
      SF_CLASSES.SF_PANEL_OPEN
    )
    expect(loading.querySelector(`.${SF_CLASSES.SF_PANEL_LOADING}`)).toBeTruthy()

    const dossier = {
      id: 'mars',
      name: 'Mars',
      kind: 'planet',
      tagline: 'Red world',
      facts: [{ label: 'Day', value: '24.6 h' }],
      history: 'Ancient observations.',
      source: 'NASA',
    }
    const loaded = mount(makeHost({ _selectedId: 'mars', _dossier: dossier }))

    expect(loaded.querySelector(`.${SF_CLASSES.SF_PANEL_TITLE}`).textContent).toBe('Mars')
    expect(loaded.querySelector(`.${SF_CLASSES.SF_FACT}`)).toBeTruthy()
    expect(loaded.querySelector(`.${SF_CLASSES.SF_PANEL_TAG}`).textContent).toBe('Planet')

    const oddKind = mount(
      makeHost({ _selectedId: 'x', _dossier: { ...dossier, kind: 'quasi-moon' } })
    )

    expect(oddKind.querySelector(`.${SF_CLASSES.SF_PANEL_TAG}`).textContent).toBe('quasi-moon')
  })

  test('action buttons call screenshot and overview handlers', () => {
    const host = makeHost()
    const root = mount(host)
    const [inst, shot, home] = root.querySelectorAll(`.${SF_CLASSES.SF_BTN}`)

    inst.click()
    shot.click()
    home.click()

    expect(host._toggleInstructions).toHaveBeenCalled()
    expect(host._takeScreenshot).toHaveBeenCalled()
    expect(host._flyHome).toHaveBeenCalled()
  })

  test('close button + live region wire the panel dismissal and announcements', () => {
    const host = makeHost({
      _selectedId: 'mars',
      _dossier: { id: 'mars', name: 'Mars', kind: 'planet' },
      _liveText: 'Mars',
    })
    const root = mount(host)

    expect(root.querySelector(`.${SF_CLASSES.SF_LIVE}`).textContent).toBe('Mars')

    root.querySelector(`.${SF_CLASSES.SF_PANEL_CLOSE}`).click()

    expect(host._closePanel).toHaveBeenCalled()
  })
})

describe('navigator hint events', () => {
  test('catalog rows emit position hints on pointer and focus', () => {
    const host = makeHost({ _navOpen: true })
    const root = mount(host)
    const btn = root.querySelector(`.${SF_CLASSES.SF_NAV_ITEM}`)

    btn.dispatchEvent(new window.Event('mouseenter'))
    expect(host._hintBody).toHaveBeenCalledWith('sun')

    btn.dispatchEvent(new window.Event('mouseleave'))
    expect(host._clearHint).toHaveBeenCalledTimes(1)

    btn.dispatchEvent(new window.Event('focus'))
    expect(host._hintBody).toHaveBeenCalledTimes(2)

    btn.dispatchEvent(new window.Event('blur'))
    expect(host._clearHint).toHaveBeenCalledTimes(2)
  })

  test('registry rows hint with their shard record and select on click', () => {
    const rec = { i: 'star-000001', n: 'Proxima', x: 1, y: 2, z: 3, d: 4.2 }
    const host = makeHost({
      _navOpen: true,
      _regManifest: {
        total: 139000,
        kinds: { star: { count: 100000, shards: ['a', 'b'] } },
      },
      _regLoaded: new Map([['star', 1]]),
      _regRecords: new Map([['star', [rec]]]),
    })
    const root = mount(host)
    const row = [...root.querySelectorAll(`.${SF_CLASSES.SF_NAV_ITEM}`)].find(
      (n) => n.dataset.body === rec.i
    )

    // Registry rows sit under the h4 kind title — each is an h5 heading.
    expect(row.closest(`h5.${SF_CLASSES.SF_NAV_ITEM_HEADING}`)).toBeTruthy()

    expect(row).toBeTruthy()

    row.dispatchEvent(new window.Event('mouseenter'))
    expect(host._hintBody).toHaveBeenCalledWith(rec.i, rec)

    row.dispatchEvent(new window.Event('mouseleave'))
    row.dispatchEvent(new window.Event('focus'))
    row.dispatchEvent(new window.Event('blur'))

    expect(host._hintBody).toHaveBeenCalledTimes(2)
    expect(host._clearHint).toHaveBeenCalledTimes(2)

    row.click()
    expect(host._selectBody).toHaveBeenCalledWith(rec.i)
  })

  test('the load-more button pages the next registry shard', () => {
    const host = makeHost({
      _navOpen: true,
      _regManifest: {
        total: 139000,
        kinds: { star: { count: 2000, shards: ['a', 'b'] } },
      },
      _regLoaded: new Map([['star', 1]]),
      _regRecords: new Map([['star', [{ i: 'star-000001', n: 'X', x: 0, y: 0, z: 0 }]]]),
    })
    const root = mount(host)
    const more = root.querySelector(`.${SF_CLASSES.SF_NAV_MORE}`)

    more.click()

    expect(host._loadMoreRegistry).toHaveBeenCalledWith('star')
  })

  test('search input routes input events to _setSearch', () => {
    const host = makeHost({ _navOpen: true })
    const root = mount(host)
    const input = root.querySelector(`.${SF_CLASSES.SF_NAV_SEARCH}`)

    input.value = 'vega'
    input.dispatchEvent(new window.Event('input'))

    expect(host._setSearch).toHaveBeenCalledWith('vega')
  })

  test('search-mode rows render _regSearch results and the searching row', () => {
    const rec = { i: 'star-000042', n: 'Vega', x: 0, y: 0, z: 0 }
    const host = makeHost({
      _navOpen: true,
      _search: 'vega',
      _regManifest: { total: 139000, kinds: {} },
      _regSearch: [rec],
      _regSearching: true,
    })
    const root = mount(host)
    const row = [...root.querySelectorAll(`.${SF_CLASSES.SF_NAV_ITEM}`)].find(
      (n) => n.dataset.body === rec.i
    )

    expect(row).toBeTruthy()
    expect(row.textContent).toContain(rec.n)
  })

  test('the instructions close button routes to _closeInstructions', () => {
    const host = makeHost({ _instructionsOpen: true })
    const root = mount(host)
    const close = root.querySelector(`.${SF_CLASSES.SF_INSTRUCTIONS_CLOSE}`)

    close.click()

    expect(host._closeInstructions).toHaveBeenCalled()
  })
})
