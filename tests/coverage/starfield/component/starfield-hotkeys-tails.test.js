/**
 * @file coverage/starfield/component/starfield-hotkeys-tails.test.js
 * @description Coverage tails for <view-star-field> printable-key
 * shortcuts — `/` opens the drawer with search focused, `n`/`i` toggle
 * the drawer and instructions, `o`/`s` fire the camera actions, the
 * modifier-key guard lets browser chords through, and the typing guard
 * keeps shortcuts (and orbit arrows) from hijacking the catalog search.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { KEYS } from '@core/tokens/primitives.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'

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
  searchRegistry: jest.fn(async () => []),
}))

// The frame loop's ML predictor fires a dynamic onnxruntime-web import
// that can resolve after the jest env tears down — not under test here.
jest.unstable_mockModule('@core/utils/ml/frame-time.js', () => ({
  FrameTimePredictor: class {
    get quality() {
      return 1
    }
    record() {}
    destroy() {}
  },
}))

await import('../../../../StarField.js')

const mount = () => {
  const el = document.createElement(VIEW_TAGS.VIEW_STAR_FIELD)

  document.body.appendChild(el)

  // happy-dom's shadowRoot.activeElement getter dereferences
  // document.activeElement.getRootNode(), which throws whenever nothing
  // holds focus — pin a null stub that individual tests can override.
  Object.defineProperty(el.shadowRoot, 'activeElement', {
    get: () => null,
    configurable: true,
  })

  return el
}

const settle = () => new Promise((r) => setTimeout(r, 60))

const unmount = async (el) => {
  // Deferred names-table/_updateDom timers must settle before detach —
  // happy-dom's shadowRoot.activeElement throws on a detached root.
  await settle()

  el.onDestroy()
  el.remove()
}

const press = (el, key, mods = {}) => {
  // cancelable:true — real keydown is cancelable; happy-dom defaults it
  // false, which would silently no-op preventDefault(). The shared
  // KeyboardEvent polyfill only copies key/code/keyCode — modifiers are
  // assigned onto the instance afterwards.
  const e = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })

  Object.assign(e, mods)
  el.dispatchEvent(e)

  return e
}

describe('StarField hotkey tails', () => {
  test('/ opens the navigator and focuses the catalog search', async () => {
    const el = mount()

    await settle()

    // happy-dom can't focus inside a shadow root (and leaves a stale
    // document.activeElement that breaks the getter) — stub focus and
    // model the browser outcome via an activeElement override.
    const origFocus = window.HTMLInputElement.prototype.focus

    window.HTMLInputElement.prototype.focus = jest.fn()

    const e = press(el, KEYS.SLASH)

    expect(e.defaultPrevented).toBe(true)
    expect(el._navOpen).toBe(true)
    expect(window.HTMLInputElement.prototype.focus).toHaveBeenCalled()

    const input = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_SEARCH}`)

    Object.defineProperty(el.shadowRoot, 'activeElement', {
      get: () => input,
      configurable: true,
    })

    expect(el.shadowRoot.activeElement.classList.contains(SF_CLASSES.SF_NAV_SEARCH)).toBe(true)

    window.HTMLInputElement.prototype.focus = origFocus

    await unmount(el)
  })

  test('n toggles the drawer, i toggles instructions, o/s hit the engine', async () => {
    const el = mount()

    await settle()

    el._engine = {
      flyHome: jest.fn(),
      takeScreenshot: jest.fn(),
      destroy: jest.fn(),
    }

    press(el, KEYS.KEY_N)
    expect(el._navOpen).toBe(true)

    press(el, KEYS.KEY_I)
    expect(el._instructionsOpen).toBe(true)

    press(el, KEYS.KEY_O)
    expect(el._engine.flyHome).toHaveBeenCalled()

    press(el, KEYS.KEY_S)
    expect(el._engine.takeScreenshot).toHaveBeenCalled()

    // Case-folded — a shifted letter fires the same action.
    press(el, KEYS.KEY_N.toUpperCase())
    expect(el._navOpen).toBe(false)

    await unmount(el)
  })

  test('modifier chords pass through untouched', async () => {
    const el = mount()

    await settle()

    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const e = press(el, KEYS.KEY_N, mods)

      expect(e.defaultPrevented).toBe(false)
      expect(el._navOpen).toBe(false)
    }

    await unmount(el)
  })

  test('typing in the shadow tree suppresses shortcuts and orbit arrows', async () => {
    const el = mount()

    await settle()

    el._engine = { rotateView: jest.fn(), destroy: jest.fn() }

    // happy-dom doesn't track shadowRoot.activeElement — stub it with a
    // fake text field so _isTyping takes the field-tag arm.
    Object.defineProperty(el.shadowRoot, 'activeElement', {
      get: () => ({ tagName: 'INPUT', isContentEditable: false }),
      configurable: true,
    })

    press(el, KEYS.SLASH)
    press(el, KEYS.KEY_N)
    press(el, KEYS.ARROW_LEFT)

    expect(el._navOpen).toBe(false)
    expect(el._engine.rotateView).not.toHaveBeenCalled()

    // An editable region hits the isContentEditable arm.
    Object.defineProperty(el.shadowRoot, 'activeElement', {
      get: () => ({ tagName: 'DIV', isContentEditable: true }),
      configurable: true,
    })

    press(el, KEYS.KEY_I)
    expect(el._instructionsOpen).toBe(false)

    // A non-field element (e.g. a focused row button) is NOT typing.
    Object.defineProperty(el.shadowRoot, 'activeElement', {
      get: () => ({ tagName: 'BUTTON', isContentEditable: false }),
      configurable: true,
    })

    press(el, KEYS.KEY_N)
    expect(el._navOpen).toBe(true)

    await unmount(el)
  })

  test('an unmapped key hits the no-action return', async () => {
    const el = mount()

    await settle()

    const e = press(el, 'q')

    expect(e.defaultPrevented).toBe(false)

    await unmount(el)
  })

  test('_focusSearch with the drawer already open skips the state flip', async () => {
    const el = mount()

    await settle()

    el._navOpen = true

    const spy = jest.spyOn(el, '_ensureRegistry')

    el._focusSearch()

    expect(spy).not.toHaveBeenCalled()
    expect(el._navOpen).toBe(true)

    await unmount(el)
  })

  test('navigator rows carry name label + describedby tech twin', async () => {
    const el = mount()

    await settle()

    el._navOpen = true
    el._updateDom()

    const btn = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV_ITEM}`)

    expect(btn.getAttribute('aria-label')).toBe(btn.childNodes[0].textContent.trim())

    const descId = btn.getAttribute('aria-describedby')

    expect(descId).toBeTruthy()
    expect(el.shadowRoot.getElementById(descId).textContent.length).toBeGreaterThan(0)

    // The drawer itself is described, and the dossier aside points at its
    // tagline once a dossier is injected.
    const nav = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_NAV}`)

    expect(nav.getAttribute('aria-describedby')).toBeTruthy()

    await unmount(el)
  })

  test('instructions sheet renders the documented key map', async () => {
    const el = mount()

    await settle()

    el._instructionsOpen = true
    el._updateDom()

    const caps = [
      ...el.shadowRoot.querySelectorAll(`.${SF_CLASSES.SF_INSTRUCTIONS_KEYCAP}`),
    ].map((k) => k.textContent.trim())

    expect(caps).toContain(KEYS.SLASH)
    expect(caps).toContain(KEYS.KEY_N.toUpperCase())
    expect(caps.length).toBeGreaterThanOrEqual(7)

    const dialog = el.shadowRoot.querySelector(`.${SF_CLASSES.SF_INSTRUCTIONS_MODAL}`)

    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()

    await unmount(el)
  })
})
