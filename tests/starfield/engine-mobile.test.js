/**
 * @file starfield/engine-mobile.test.js
 * @description engine/mobile.ts — isLowPowerMobile detection arms
 * (Android/mobile UA, low hardwareConcurrency, low deviceMemory,
 * capable-desktop and missing-navigator negatives) plus the
 * initStarRenderer early-bail that keeps mobile devices on the
 * prebuilt 2D starfield instead of the GPU boot that freezes the
 * main thread under mobile Lighthouse.
 */
import { describe, test, expect, afterEach, jest } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { isLowPowerMobile, LOW_POWER_LIMITS } from '../../engine/mobile.js'
import { initStarRenderer } from '../../engine/renderer-setup.js'
import { createStarState } from '../../engine/state.js'

// Representative user agents — fixture-only data, not app strings.
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'
const UA_ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

let prevUA
let prevCores
let prevMemory

const setEnv = (ua, cores, memory) => {
  prevUA = globalThis.navigator.userAgent
  prevCores = globalThis.navigator.hardwareConcurrency
  prevMemory = globalThis.navigator.deviceMemory

  Object.defineProperty(globalThis.navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
    value: cores,
    configurable: true,
  })
  Object.defineProperty(globalThis.navigator, 'deviceMemory', {
    value: memory,
    configurable: true,
  })
}

const restoreEnv = () => {
  Object.defineProperty(globalThis.navigator, 'userAgent', { value: prevUA, configurable: true })
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
    value: prevCores,
    configurable: true,
  })
  Object.defineProperty(globalThis.navigator, 'deviceMemory', {
    value: prevMemory,
    configurable: true,
  })
}

afterEach(restoreEnv)

describe('engine mobile — isLowPowerMobile', () => {
  test('Android phone and tablet user agents report low-power mobile', () => {
    setEnv(UA_ANDROID, 8, 8)
    expect(isLowPowerMobile()).toBe(true)

    setEnv(UA_ANDROID_TABLET, 8, 8)
    expect(isLowPowerMobile()).toBe(true)
  })

  test('capable desktop UA with strong hardware is not low-power', () => {
    setEnv(UA_DESKTOP, LOW_POWER_LIMITS.CORES + 4, LOW_POWER_LIMITS.MEMORY_GB + 4)

    expect(isLowPowerMobile()).toBe(false)
  })

  test('desktop UA under the core-count floor reports low-power', () => {
    setEnv(UA_DESKTOP, LOW_POWER_LIMITS.CORES, LOW_POWER_LIMITS.MEMORY_GB + 4)

    expect(isLowPowerMobile()).toBe(true)
  })

  test('desktop UA under the memory floor reports low-power', () => {
    setEnv(UA_DESKTOP, LOW_POWER_LIMITS.CORES + 4, LOW_POWER_LIMITS.MEMORY_GB)

    expect(isLowPowerMobile()).toBe(true)
  })

  test('missing hardware hints do not mark a capable desktop low-power', () => {
    setEnv(UA_DESKTOP, undefined, undefined)

    expect(isLowPowerMobile()).toBe(false)
  })

  test('empty user agent falls back to the empty-string arm', () => {
    setEnv(undefined, LOW_POWER_LIMITS.CORES + 4, LOW_POWER_LIMITS.MEMORY_GB + 4)

    expect(isLowPowerMobile()).toBe(false)
  })

  test('missing navigator reports not-low-power', () => {
    const prev = globalThis.navigator

    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true })

    try {
      expect(typeof navigator).toBe(TYPE_STRINGS.UNDEFINED)
      expect(isLowPowerMobile()).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: prev, configurable: true })
    }
  })
})

describe('engine mobile — initStarRenderer bail', () => {
  test('Android never constructs the renderer — the 2D fallback takes over', async () => {
    setEnv(UA_ANDROID, 8, 8)

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
