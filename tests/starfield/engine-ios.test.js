/**
 * @file starfield/engine-ios.test.js
 * @description engine/ios.ts — isIOSDevice UA-detection arms (iPhone/iPad
 * token, the iPadOS Macintosh+multi-touch disguise, desktop/Android
 * negatives, missing navigator) plus the initStarRenderer early-bail
 * that keeps iOS on the prebuilt 2D starfield instead of the GPU boot.
 */
import { describe, test, expect, afterEach, jest } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { isIOSDevice } from '../../engine/ios.js'
import { initStarRenderer } from '../../engine/renderer-setup.js'
import { createStarState } from '../../engine/state.js'

// Representative user agents — one per detection arm. Fixture-only data,
// not app strings.
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const UA_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const UA_MAC_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

let prevUA
let prevTouch

const setUA = (ua, touch) => {
  prevUA = globalThis.navigator.userAgent
  prevTouch = globalThis.navigator.maxTouchPoints

  Object.defineProperty(globalThis.navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
    value: touch,
    configurable: true,
  })
}

const restoreUA = () => {
  Object.defineProperty(globalThis.navigator, 'userAgent', { value: prevUA, configurable: true })
  Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
    value: prevTouch,
    configurable: true,
  })
}

afterEach(restoreUA)

describe('engine ios — isIOSDevice', () => {
  test('iPhone and iPad user agents report iOS', () => {
    setUA(UA_IPHONE, 5)
    expect(isIOSDevice()).toBe(true)

    setUA(UA_IPAD, 5)
    expect(isIOSDevice()).toBe(true)
  })

  test('iPadOS desktop-mode disguise — Macintosh UA plus multi-touch — reports iOS', () => {
    setUA(UA_MAC_DESKTOP_MODE, 5)

    expect(isIOSDevice()).toBe(true)
  })

  test('Macintosh UA without touch is a real desktop Mac', () => {
    setUA(UA_MAC_DESKTOP_MODE, 0)

    expect(isIOSDevice()).toBe(false)
  })

  test('Android and desktop browsers are not iOS', () => {
    setUA(UA_ANDROID, 5)
    expect(isIOSDevice()).toBe(false)

    setUA(UA_DESKTOP, 0)
    expect(isIOSDevice()).toBe(false)
  })

  test('empty user agent falls back to the empty-string arm', () => {
    setUA(undefined, 0)

    expect(isIOSDevice()).toBe(false)
  })

  test('missing navigator reports not-iOS', () => {
    const prev = globalThis.navigator

    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true })

    try {
      expect(typeof navigator).toBe(TYPE_STRINGS.UNDEFINED)
      expect(isIOSDevice()).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: prev, configurable: true })
    }
  })
})

describe('engine ios — initStarRenderer bail', () => {
  test('iOS never constructs the renderer — the 2D fallback takes over', async () => {
    setUA(UA_IPHONE, 5)

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))
    const construct = jest.fn()

    class SpyRenderer {
      constructor() {
        construct()
      }

      async init() {}
    }

    expect(await initStarRenderer(s, SpyRenderer)).toBe(false)
    expect(construct).not.toHaveBeenCalled()
    expect(s.renderer).toBeFalsy()
  })
})
