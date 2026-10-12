/**
 * @file engine/frame.ts
 * @description Per-frame orchestrator for the star-field engine: the
 * self-rescheduling RAF tick (`tickStar` → `tickFrame`) drives orbit
 * pivots, self-rotation, satellite spins, the fly-to tween, and every
 * per-frame update under `frame/`:
 *
 *   `frame/shared.ts`  — lazily-armed Vec3/Color constructors (bootstrap
 *                        injects them so these modules never import three).
 *   `frame/camera.ts`  — anchor projection, arrow-key orbit, resize
 *                        measure, selected-body follow.
 *   `frame/updates.ts` — approach prefetch, LOD, structure/galaxy/star
 *                        -cloud fades, hover tracking.
 *   `frame/fx.ts`      — pulse/cycle/corona ambient-life effects.
 */
import { SF_MOTION, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { updateFly } from './fly.js'
import { devError } from '@core/devlog.js'
import type { SFState } from './types.js'

import { followSelected } from './frame/camera.js'
import {
  checkApproach,
  trackHover,
  updateDayNight,
  updateGalaxyClouds,
  updateLod,
  updateStarCloud,
  updateStructures,
} from './frame/updates.js'
import { updateFx } from './frame/fx.js'

export { armFrame } from './frame/shared.js'
export {
  anchorScreenPos,
  anchorWorldPos,
  handleStarResize,
  rotateStarCamera,
} from './frame/camera.js'

/**
 * Per-frame update, self-rescheduling via RAF:
 *   orbits — pivot.rotation.y = phase + t·ORBIT_SPEED·speed
 *   spins  — spinner.rotation.y advances by SPIN_SPEED·spin·dt
 *   satellites — same orbit formula on child pivots
 *   fly    — eased camera tween overrides manual control until done
 *   render — plain renderer.render (no post pipeline in this engine)
 * @param s Engine state.
 * @param now RAF timestamp in ms — falls back to performance.now.
 */
export function tickStar(s: SFState, now?: number): void {
  if (s.disposed || s.reduced || s.failed) return

  s.animId = requestAnimationFrame((t) => tickStar(s, t))

  try {
    tickFrame(s, now)
  } catch (err) {
    // A frame that throws (driver loss, shader fault) would otherwise keep
    // rescheduling on a dead context — stop the loop, mark failed, and let
    // the host swap in the 2D fallback starfield. cancelAnimationFrame is
    // a spec'd no-op on a null/0 handle, so no guard is needed here.
    cancelAnimationFrame(s.animId as number)

    s.animId = null

    s.failed = true

    devError('[StarField] frame error:', err)

    s.onLost?.()
  }
}

/**
 * The frame body — separated from tickStar so a throw in any update/render
 * step is catchable at the self-rescheduling boundary.
 * @param s Engine state.
 * @param now RAF timestamp in ms — falls back to performance.now.
 */
function tickFrame(s: SFState, now?: number): void {
  const t = (now ?? performance.now()) / 1000

  const dt = Math.min(0.1, Math.max(0, t - s.lastT))

  s.lastT = t
  s.t += dt

  for (const node of s.nodes.values()) {
    const def = node.def

    if (def.orbit != null && def.speed) {
      node.pivot.rotation.y = (def.phase ?? 0) + s.t * SF_MOTION.ORBIT_SPEED * def.speed

      // Inertial axis lock — cancel the orbital Y-rotation on the tilt
      // group so the spin axis stays fixed in the parent frame: the
      // terminator sweeps the hemispheres over the year (real seasons)
      // instead of the axis precessing with the body's position.
      if (node.lock) node.lock.rotation.y = -node.pivot.rotation.y

      // Eccentric orbits keep the uniform angular sweep (the chart is a
      // stylized map, not an N-body solver) but modulate the mesh's
      // radial distance along the conic — r = a(1−e²)/(1+e·cos θ),
      // periapsis at the authored phase direction — so Halley-class
      // comets visibly plunge in and coast out instead of circling.
      if (def.ecc) {
        const th = node.pivot.rotation.y - (def.phase ?? 0)

        node.mesh.position.x = (def.orbit * (1 - def.ecc * def.ecc)) / (1 + def.ecc * Math.cos(th))
      }
    }

    if (def.spin) {
      node.spinner.rotation.y = s.t * SF_MOTION.SPIN_SPEED * def.spin

      // Differential rotation — a volumetric galaxy's inner-disc rotor
      // spins faster than the rigid rim so the core visibly laps the
      // outer arms, the honest read of a flat rotation curve.
      if (node.rotor) {
        node.rotor.rotation.y = s.t * SF_MOTION.SPIN_SPEED * def.spin * SF_SPIRAL.ROTOR_DIFF
      }
    }

    for (const sat of node.satPivots) {
      sat.pivot.rotation.y = sat.phase + s.t * SF_MOTION.ORBIT_SPEED * sat.speed

      if (sat.ecc) {
        const th = sat.pivot.rotation.y - sat.phase

        sat.mesh.position.x = (sat.orbit * (1 - sat.ecc * sat.ecc)) / (1 + sat.ecc * Math.cos(th))
      }
    }
  }

  // Pin the followed anchor at the floating origin first so the fly
  // tween's live `track()` resolves in the pinned frame — a select then
  // glides only the local gap to the body, not the raw galactic span.
  followSelected(s)

  updateFly(s)

  checkApproach(s)

  updateLod(s)

  updateStructures(s)

  updateGalaxyClouds(s)

  updateStarCloud(s)

  updateFx(s)

  updateDayNight(s)

  s.controls?.update()

  if (s.renderer && s.scene && s.camera) {
    s.renderer.render(s.scene, s.camera)
  }

  trackHover(s)
}
