/**
 * @file coverage/starfield/component/starfield-component-tails.test.js
 * @description Coverage tails for <view-star-field> — the rare component
 * arms the lifecycle suite doesn't reach: canvas re-mount guard,
 * keybound teardown, Escape dismissal precedence, detached-host live
 * regions, unknown-id name lookup, null-engine optional calls and the
 * Escape/re-render guards.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { LOCALES } from '@core/tokens/locales.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { KEYS } from '@core/tokens/primitives.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { SF_MUSIC_TRACKS } from '@core/tokens/starfield/music.js'
import { SF_CSS_PROPS } from '@core/tokens/css/starfield.js'
import { POINTER_EVENTS } from '@core/tokens/events/dom.js'
import { BREAKPOINTS } from '@core/tokens/layout/breakpoints.js'

const dbData = { title: 'Star Field' }

jest.unstable_mockModule('@core/utils/data/db.js', () => ({
  fetchFirebaseDb: jest.fn(async () => ({ exists: () => true, val: () => dbData })),
}))

jest.unstable_mockModule('../../../../engine/registry.js', () => ({
  ensureRegistryManifest: jest.fn(async () => null),
  isRegistryId: (id) => /^\w+-\d{6}$/.test(id),
  loadRegistryRecord: jest.fn(async () => null),
  loadRegistryShard: jest.fn(async () => null),
  registryWorldPos: jest.fn(() => null),
  searchRegistry: jest.fn(async (q) => [{ i: 'star-000001', n: q, x: 0, y: 0, z: 0 }]),
}))

await import('../../../../StarField.js')

const mount = () => {
  const el = document.createElement(VIEW_TAGS.VIEW_STAR_FIELD)

  document.body.appendChild(el)

  return el
}

const unmount = (el) => {
  el.onDestroy()
  el.remove()
}

const esc = (el) =>
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key: KEYS.ESCAPE, bubbles: true }))

describe('StarField coverage tails', () => {
  test('clicking a playlist track loads and marks it through _playMusic', async () => {
    const el = mount()

    await new Promise((r) => setTimeout(r, 40))

    const tracks = el.shadowRoot.querySelectorAll(`.${SF_CLASSES.SF_MUSIC_TRACK}`)

    expect(tracks).toHaveLength(SF_MUSIC_TRACKS.length)

    tracks[2].click()

    await new Promise((r) => setTimeout(r, 0))

    expect(el._musicIndex).toBe(2)
    expect(el._musicEl.getAttribute('src')).toBe(SF_MUSIC_TRACKS[2].src)

    const after = el.shadowRoot.querySelectorAll(`.${SF_CLASSES.SF_MUSIC_TRACK}`)

    expect(after[2].classList.contains(SF_CLASSES.SF_MUSIC_TRACK_ACTIVE)).toBe(true)

    unmount(el)
  })

  test('second onMounted hits the canvas-already-mounted guard', async () => {
    const el = mount()

    await new Promise((r) => setTimeout(r, 40))

    const canvas = el._canvasEl

    el.onMounted()

    expect(el._canvasEl).toBe(canvas)

    unmount(el)
  })

  test('onDestroy removes a bound Escape handler', async () => {
    const el = mount()

    expect(el._onKeyDown).toBeTruthy()

    el._bindKeys()

    const first = el._onKeyDown

    el._bindKeys()

    expect(el._onKeyDown).toBe(first)

    unmount(el)

    expect(el._onKeyDown).toBeNull()
  })

  test('Escape precedence — panel first, drawer second, neither last', () => {
    const el = mount()

    el._selectedId = 'mars'
    el._navOpen = true
    esc(el)

    expect(el._selectedId).toBeNull()
    expect(el._navOpen).toBe(true)

    esc(el)

    expect(el._navOpen).toBe(false)

    esc(el)

    unmount(el)
  })

  test('detached host — live-region lookups and engine optional calls no-op', () => {
    const el = document.createElement(VIEW_TAGS.VIEW_STAR_FIELD)

    el._handleHover('mars')

    expect(el._liveText).toBe('Mars')

    el._handleHover('unknown-id')

    expect(el._liveText).toBe('')

    el._announce('unknown-id')

    expect(el._liveText).toBe('')

    el._engine = null
    el._selectBody('mars')
    el._takeScreenshot()
    el._flyHome()
    el._toggleNav()
    el._closePanel()
    el._dismissLoader()
    el._updateLoader('x', 5)
    el._loadTranslations()
    el._applyTranslations(dbData)
    el.onUpdated()
    el.onDestroy()
  })

  test('onStoreUpdate refetches only on a real locale change', () => {
    const el = mount()

    el._loadTranslations = jest.fn()

    el._lastLocale = LOCALES.DE
    el.onStoreUpdate()

    expect(el._loadTranslations).toHaveBeenCalled()

    el._lastLocale = null
    el.onStoreUpdate()

    expect(el._loadTranslations).toHaveBeenCalledTimes(1)

    unmount(el)
  })

  test('render() returns the loader view pre-boot', () => {
    const el = document.createElement(VIEW_TAGS.VIEW_STAR_FIELD)

    expect(el.render()).toBeTruthy()
  })
})

describe('navigator hints + instructions dismissal tails', () => {
  test('pointerdown outside the modal dismisses instructions; inside keeps them', async () => {
    const el = mount()

    await new Promise((r) => setTimeout(r, 40))

    el._instructionsOpen = true

    el._updateDom()

    const down = (node) =>
      node.dispatchEvent(new window.Event(POINTER_EVENTS.POINTERDOWN, { bubbles: true }))

    // Inside the modal — the closest() guard keeps it open.
    const modal = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_INSTRUCTIONS_MODAL}`)

    down(modal)
    expect(el._instructionsOpen).toBe(true)

    // On the trigger button — toggling stays the button's job.
    const btn = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_INSTRUCTIONS_BTN}`)

    down(btn)
    expect(el._instructionsOpen).toBe(true)

    // Anywhere else in the view — dismissed.
    down(el.shadowRoot.querySelector(`.${SF_CLASSES.SF_LIVE}`))
    expect(el._instructionsOpen).toBe(false)

    unmount(el)
  })

  test('Escape closes the instructions modal before the panel and drawer', () => {
    const el = mount()

    el._instructionsOpen = true
    el._selectedId = 'mars'
    el._navOpen = true

    esc(el)

    expect(el._instructionsOpen).toBe(false)
    expect(el._selectedId).toBe('mars')
    expect(el._navOpen).toBe(true)

    unmount(el)
  })

  test('arrow keys dismiss the instructions modal while orbiting', () => {
    const el = mount()

    el._instructionsOpen = true
    el._engine = { rotateView: jest.fn() }

    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: KEYS.ARROW_LEFT, bubbles: true }))

    expect(el._instructionsOpen).toBe(false)
    expect(el._engine.rotateView).toHaveBeenCalled()

    el._engine = null

    unmount(el)
  })

  test('mobile selection closes the open drawer', () => {
    const el = mount()

    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: BREAKPOINTS[768] - 1,
    })

    el._navOpen = true
    el._selectBody('mars')

    expect(el._navOpen).toBe(false)

    if (width) Object.defineProperty(window, 'innerWidth', width)

    unmount(el)
  })

  test('edge-mode hover positions flip the label toward the canvas', () => {
    const el = mount()

    const tip = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_TIP}`)

    // Object off the right rim — the label flips left of the marker.
    el._handleHoverMove('mars', 10, 20, true, 0)

    expect(tip.classList.contains(SF_CLASSES.SF_TIP_EDGE)).toBe(true)
    expect(tip.classList.contains(SF_CLASSES.SF_TIP_FLIPX)).toBe(true)
    expect(tip.classList.contains(SF_CLASSES.SF_TIP_FLIPY)).toBe(false)
    expect(tip.style.getPropertyValue(SF_CSS_PROPS.TIP_ANGLE)).toBe('0deg')

    // Object below the rim — the label flips above the marker.
    el._handleHoverMove('mars', 10, 20, true, 270)

    expect(tip.classList.contains(SF_CLASSES.SF_TIP_FLIPX)).toBe(false)
    expect(tip.classList.contains(SF_CLASSES.SF_TIP_FLIPY)).toBe(true)
    expect(tip.style.getPropertyValue(SF_CSS_PROPS.TIP_ANGLE)).toBe('270deg')

    // Back on-screen — edge mode and both flips clear.
    el._handleHoverMove('mars', 10, 20, false)

    expect(tip.classList.contains(SF_CLASSES.SF_TIP_EDGE)).toBe(false)
    expect(tip.classList.contains(SF_CLASSES.SF_TIP_FLIPX)).toBe(false)
    expect(tip.classList.contains(SF_CLASSES.SF_TIP_FLIPY)).toBe(false)

    unmount(el)
  })

  test('detached-tip hover move is a no-op', () => {
    const el = document.createElement(VIEW_TAGS.VIEW_STAR_FIELD)

    el._handleHoverMove('mars', 10, 20, true, 45)
  })

  test('navigator hint methods proxy the engine setHint contract', () => {
    const el = mount()

    el._engine = { setHint: jest.fn() }

    el._hintBody('mars')
    expect(el._engine.setHint).toHaveBeenCalledWith('mars', undefined)

    const rec = { i: 'star-000001', n: 'X', x: 1, y: 2, z: 3 }

    el._hintBody(rec.i, rec)
    expect(el._engine.setHint).toHaveBeenCalledWith(rec.i, rec)

    el._clearHint()
    expect(el._engine.setHint).toHaveBeenCalledWith(null)

    el._engine = null
    el._hintBody('mars')
    el._clearHint()

    unmount(el)
  })

  test('an empty search clears registry state without fetching', () => {
    const el = mount()

    el._regSearch = [{ i: 'star-000001' }]
    el._regSearching = true
    el._setSearch('   ')

    expect(el._regSearch).toBeNull()
    expect(el._regSearching).toBe(false)

    unmount(el)
  })

  test('a query fires the registry search and stale responses are dropped', async () => {
    const el = mount()

    el._setSearch('vega')

    expect(el._regSearching).toBe(true)

    // A newer query wins — the in-flight response must not overwrite.
    el._setSearch('mars')

    await new Promise((r) => setTimeout(r, 60))

    expect(el._regQuery).toBe('mars')
    expect(el._regSearching).toBe(false)
    expect(Array.isArray(el._regSearch)).toBe(true)

    unmount(el)
  })

  test('re-render restores focus and cursor on the search input', async () => {
    const el = mount()

    el._navOpen = true
    el._search = 've'

    el._updateDom()

    const input = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_SEARCH}`)

    input.focus()
    input.setSelectionRange(1, 1)

    // happy-dom doesn't track shadowRoot.activeElement and its focus()
    // crashes inside a shadow root — stub both so the
    // focus-preservation arms run like in a real DOM.
    const activeStub = { get: () => input, configurable: true }

    Object.defineProperty(el.shadowRoot, 'activeElement', activeStub)

    const origFocus = window.HTMLInputElement.prototype.focus

    window.HTMLInputElement.prototype.focus = jest.fn()

    el._updateDom()

    const after = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_SEARCH}`)

    expect(window.HTMLInputElement.prototype.focus).toHaveBeenCalled()
    expect(after.selectionStart).toBe(1)
    expect(after.selectionEnd).toBe(1)

    window.HTMLInputElement.prototype.focus = origFocus

    unmount(el)
  })

  test('re-render skips cursor restore when the selection reads null', () => {
    const el = mount()

    el._navOpen = true

    el._updateDom()

    // A search-focused element whose selection is unreadable (e.g. a
    // UA that reports null selectionStart on type=search) still gets
    // focus back — only the range restore is skipped.
    const fakeFocused = {
      classList: { contains: (c) => c === SF_CLASSES.SF_NAV_SEARCH },
      selectionStart: 2,
      selectionEnd: null,
    }

    Object.defineProperty(el.shadowRoot, 'activeElement', {
      get: () => fakeFocused,
      configurable: true,
    })

    const origFocus = window.HTMLInputElement.prototype.focus

    window.HTMLInputElement.prototype.focus = jest.fn()

    el._updateDom()

    expect(window.HTMLInputElement.prototype.focus).toHaveBeenCalled()

    // Search still "focused" but the scoped query now finds nothing —
    // the null-$() arm bails before any focus work.
    el.$ = () => null

    el._updateDom()

    window.HTMLInputElement.prototype.focus = origFocus

    unmount(el)
  })

  test('arrow key before engine boot is a no-op', () => {
    const el = mount()

    // Engine still null pre-boot (or after destroy) — the orbit keys
    // must not throw or preventDefault into a dead delegate.
    el._engine = null

    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: KEYS.ARROW_RIGHT, bubbles: true }))

    expect(el._engine).toBeNull()

    unmount(el)
  })
})
