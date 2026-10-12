/**
 * @file engine/fly.ts
 * @description Camera fly-to tween for the star-field engine — when a body
 * is selected the camera glides to a framing offset of the body while the
 * controls target lerps to the body center, over FLY_MS with cubic
 * ease-in-out. Any user drag/wheel cancels the tween immediately so the
 * controls never fight the user.
 */
import { SF_CAMERA, SF_MOTION } from '@core/tokens/starfield/params.js'
import type { SFState } from './types.js'

/**
 * Cubic ease-in-out — slow start, fast middle, gentle arrival; the same
 * curve the site prefers for long camera moves.
 */
const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2

/**
 * Arms a fly-to tween: destination is `offset` units along the current
 * camera→body direction (or straight above when the camera is too close
 * to define a direction), target tracks the body's live world position.
 * @param s Engine state.
 * @param track Body world-position getter — re-resolved per frame so a
 *   moving (rider-mounted) anchor can't leave the camera landing on a
 *   stale spot; null return freezes the last destination.
 * @param offset Standoff distance — scaled per body so giants frame wide.
 * @param done Optional completion callback.
 */
export function startFly(
  s: SFState,
  track: () => { x: number; y: number; z: number } | null,
  offset: number,
  done?: () => void
): void {
  const cam = s.camera

  if (!cam) return

  const worldPos = track()

  if (!worldPos) return

  const cx = cam.position.x
  const cy = cam.position.y
  const cz = cam.position.z

  let dx = cx - worldPos.x
  let dy = cy - worldPos.y
  let dz = cz - worldPos.z

  const len = Math.hypot(dx, dy, dz)

  if (len < 0.001) {
    dx = 0
    dy = offset
    dz = 0
  } else {
    dx = (dx / len) * offset
    dy = (dy / len) * offset + offset * 0.35
    dz = (dz / len) * offset
  }

  const tgt = s.controls?.target

  s.fly = {
    t0: performance.now(),
    fromPos: { x: cx, y: cy, z: cz },
    offset: { x: dx, y: dy, z: dz },
    fromTgt: {
      x: tgt?.x ?? SF_CAMERA.TARGET_X,
      y: tgt?.y ?? SF_CAMERA.TARGET_Y,
      z: tgt?.z ?? SF_CAMERA.TARGET_Z,
    },
    track,
    last: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    done,
  }
}

/**
 * Advances the active tween one frame — lerps camera position and the
 * controls target along the eased progress; clears `s.fly` and fires
 * `done` when complete.
 * @param s Engine state.
 */
export function updateFly(s: SFState): void {
  const fly = s.fly

  if (!fly || !s.camera) return

  const p = Math.min(1, (performance.now() - fly.t0) / SF_MOTION.FLY_MS)

  const e = easeInOutCubic(p)

  const live = fly.track()

  // `track` returns the shared armed-scratch vector — copy the components
  // so a later per-frame caller (label projection, hover leader line,
  // followSelected) can't hijack the destination by mutating it.
  if (live) fly.last = { x: live.x, y: live.y, z: live.z }

  const lerp = (a: number, b: number) => a + (b - a) * e

  s.camera.position.set(
    lerp(fly.fromPos.x, fly.last.x + fly.offset.x),
    lerp(fly.fromPos.y, fly.last.y + fly.offset.y),
    lerp(fly.fromPos.z, fly.last.z + fly.offset.z)
  )

  if (s.controls) {
    s.controls.target.set(
      lerp(fly.fromTgt.x, fly.last.x),
      lerp(fly.fromTgt.y, fly.last.y),
      lerp(fly.fromTgt.z, fly.last.z)
    )
  }

  if (p >= 1) {
    const done = fly.done

    s.fly = null

    done?.()
  }
}

/**
 * Cancels an in-flight tween — called on user pointer/wheel input so
 * manual control always wins over the animation.
 * @param s Engine state.
 */
export function cancelFly(s: SFState): void {
  s.fly = null
}
