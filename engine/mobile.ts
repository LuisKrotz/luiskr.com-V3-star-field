/**
 * @file engine/mobile.ts
 * @description Mobile/low-power capability bail-out for the star-field
 * engine — the Android counterpart of ios.ts, kept in its own file so
 * the iOS path stays untouched. The full WebGPU/WebGL boot (texture
 * memory, logarithmic depth buffer, bloom chain) blows the mobile
 * memory budget and blocks the main thread long enough that mobile
 * Lighthouse reports "LHR failed to render" — the page freezes under
 * throttled emulation even though no exception is thrown. Mobile-class
 * devices therefore take the prebuilt 2D fallback starfield, exactly
 * like a reduced-motion session. Desktop UAs are unaffected — the
 * check is a pure UA read plus hardware-concurrency/deviceMemory hints
 * with no effect on capable machines.
 */

import { UA_PATTERNS } from '@core/tokens/motion/gpu.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'

/**
 * Low-end hardware ceilings — below these the GPU boot is a guaranteed
 * freeze even on desktop UAs (software rasterizers, thin clients).
 * `CORES` is a navigator.hardwareConcurrency floor, `MEMORY_GB` the
 * deviceMemory floor; either signal alone marks the device weak.
 */
export const LOW_POWER_LIMITS = Object.freeze({
  CORES: 4,
  MEMORY_GB: 4,
})

/**
 * Whether the runtime is a mobile-class or clearly low-power device —
 * mobile UA token (Android/Mobile — iPhone/iPad already bail through
 * isIOSDevice before this runs), or hardware hints below the
 * LOW_POWER_LIMITS floor. Returns false on capable desktops and when
 * navigator is unavailable.
 * @returns true when the engine should skip the GPU boot for the 2D fallback.
 */
export const isLowPowerMobile = (): boolean => {
  if (typeof navigator === TYPE_STRINGS.UNDEFINED) return false

  const ua = navigator.userAgent || ''

  if (UA_PATTERNS.MOBILE_UA.test(ua)) return true

  const cores = navigator.hardwareConcurrency ?? 0

  if (cores > 0 && cores <= LOW_POWER_LIMITS.CORES) return true

  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 0

  return memory > 0 && memory <= LOW_POWER_LIMITS.MEMORY_GB
}
