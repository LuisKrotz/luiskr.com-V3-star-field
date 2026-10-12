/**
 * @file engine/frame/fx.ts
 * @description Ambient-life per-frame effects — `pulse` bodies (variable
 * stars, pulsars, flaring cores) breathe via a sine scale oscillation;
 * `cycle` bodies (Earth's glaciation) lerp the surface tint between the
 * armed warm/ice ramp; star corona sprites slowly rotate and shimmer.
 * Split out of frame.ts.
 */
import { armed } from './shared.js'
import type { SFState } from '../types.js'

/**
 * Ambient life — the small "alive" behaviors on top of the static chart:
 * `pulse` bodies (variable stars, pulsars, flaring cores) breathe via a
 * sine scale oscillation; `cycle` bodies (Earth's glaciation) lerp the
 * surface tint between the neutral white and the ice-age palette.
 * @param s Engine state.
 */
export function updateFx(s: SFState): void {
  for (const node of s.nodes.values()) {
    const def = node.def

    if (def.pulse) {
      const k = 1 + def.pulse.amp * Math.sin((2 * Math.PI * s.t) / def.pulse.period)

      node.mesh.scale.setScalar?.(k)
    }

    if (def.cycle && armed.ice && armed.warm) {
      const holder = node.mesh as {
        material?: { color?: { lerpColors?: (a: never, b: never, k: number) => unknown } }
      }

      const mat = holder.material

      // Axis-locked bodies sync the tint to the orbit angle — the
      // inertially fixed axis makes `dot(axis, sunDir) ∝ cos(orbit θ)`,
      // so warm peaks at northern summer exactly when the terminator
      // favors the north. Unlocked bodies keep the free-running sine.
      const k = node.lock
        ? 0.5 + 0.5 * Math.cos(node.pivot.rotation.y)
        : 0.5 + 0.5 * Math.sin((2 * Math.PI * s.t) / def.cycle.period)

      mat?.color?.lerpColors?.(armed.warm as never, armed.ice as never, k)
    }

    // Star corona — slow in-plane rotation plus a subtle brightness
    // breathe makes the streamer field shimmer like a live photosphere.
    if (node.corona) {
      const co = node.corona

      co.material.rotation = co.phase + s.t * co.rate
      co.material.opacity = 0.55 + 0.2 * Math.sin(s.t * (co.rate * 6) + co.phase)
    }
  }
}
