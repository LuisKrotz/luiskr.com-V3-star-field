/**
 * @file engine/ios.ts
 * @description iOS/iPadOS capability bail-out for the star-field engine.
 * Safari on iPhone/iPad hard-kills the tab partway through the full
 * WebGPU/WebGL boot — the scene's texture memory and the logarithmic
 * depth buffer blow the mobile jetsam budget, leaving a reload loop
 * instead of a chart. `isIOSDevice()` detects the platform (UA token
 * plus the iPadOS-13 "Macintosh" desktop-mode disguise) so
 * initStarRenderer can bail before any GL context is allocated: the
 * engine then takes the prebuilt 2D fallback starfield exactly like a
 * reduced-motion session. Other platforms are untouched — the check is
 * a pure UA read with no effect on non-Apple devices.
 */

import { UA_PATTERNS } from '@core/tokens/motion/gpu.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'

/**
 * Whether the runtime is an iOS-family device — direct iPhone/iPad/iPod
 * UA match, or iPadOS 13+ "desktop mode" which reports a Macintosh UA
 * while still exposing multi-touch (`maxTouchPoints > 0`).
 * @returns true on iPhone, iPad and iPod touch; false everywhere else.
 */
export const isIOSDevice = (): boolean => {
  if (typeof navigator === TYPE_STRINGS.UNDEFINED) return false

  const ua = navigator.userAgent || ''

  if (UA_PATTERNS.IOS_UA.test(ua)) return true

  return UA_PATTERNS.MACINTOSH_UA.test(ua) && navigator.maxTouchPoints > 0
}
