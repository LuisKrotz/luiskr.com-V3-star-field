/**
 * @file engine/frame/fx.ts
 * @description Ambient-life per-frame effects — `pulse` bodies (variable
 * stars, pulsars, flaring cores) breathe via a sine scale oscillation;
 * `cycle` bodies (Earth's glaciation) lerp the surface tint between the
 * armed warm/ice ramp; star corona sprites slowly rotate and shimmer.
 * Split out of frame.ts.
 */
import { SF_METEOR, SF_NEBULA_DEPTH, SF_SOLAR_WIND } from '@core/tokens/starfield/params.js'
import { armed } from './shared.js'
import type { SFState } from '../types.js'

/**
 * Solar-wind level — the shared activity signal every wind-touched
 * system reads from `s.solarWind`/`s.fxTime`: a slow BASE+WAVE swell
 * (the ~11-year-style activity cycle compressed to scene seconds) plus
 * sharp storm spikes from two detuned sines raised to a high power —
 * rare, brief, bright gusts that make auroras ignite and flares leap.
 * @param t Scene seconds.
 * @returns Activity level (0 quiet … ~1.5 storm).
 */
function solarWindAt(t: number): number {
  const W = SF_SOLAR_WIND

  const swell = W.BASE + W.WAVE_AMP * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / W.WAVE_PERIOD))

  const spike =
    Math.pow(Math.max(0, Math.sin(t * W.STORM_F1) * Math.sin(t * W.STORM_F2 + 1.3)), W.STORM_POW) *
    W.STORM_GAIN

  return swell + spike
}

/**
 * Ambient life — the small "alive" behaviors on top of the static chart:
 * `pulse` bodies (variable stars, pulsars, flaring cores) breathe via a
 * sine scale oscillation; `cycle` bodies (Earth's glaciation) lerp the
 * surface tint between the neutral white and the ice-age palette.
 * @param s Engine state.
 */
export function updateFx(s: SFState): void {
  // Shared uniforms — one write per frame drives the weather field's
  // evolution, aurora curtain drift, and every wind-scaled emission.
  if (s.fxTime) s.fxTime.value = s.t

  const wind = solarWindAt(s.t)

  if (s.solarWind) s.solarWind.value = wind

  for (const node of s.nodes.values()) {
    const def = node.def

    if (def.pulse) {
      const k = 1 + def.pulse.amp * Math.sin((2 * Math.PI * s.t) / def.pulse.period)

      node.mesh.scale.setScalar?.(k)
    }

    // Living nebulae — each depth layer swirls its UV rotation at its
    // own seeded rate (the echo counter-rotates, reading as a shear
    // between gas at different depths) and shimmers opacity on a
    // detuned sine; the whole sprite breathes ±BREATHE_AMP so the
    // cloud swells like gas under pressure waves. Rates come from the
    // body id hash, so every nebula churns at its own pace.
    if (node.nebula) {
      const neb = node.nebula

      for (const layer of neb.layers) {
        layer.material.rotation = layer.phase + s.t * layer.rate

        layer.material.opacity =
          layer.opBase * (1 - SF_NEBULA_DEPTH.OP_WAVE) +
          layer.opBase *
            SF_NEBULA_DEPTH.OP_WAVE *
            (0.5 + 0.5 * Math.sin(s.t * SF_NEBULA_DEPTH.OP_FREQ + layer.phase * 3))
      }

      const k =
        1 + SF_NEBULA_DEPTH.BREATHE_AMP * Math.sin(s.t * SF_NEBULA_DEPTH.BREATHE_FREQ + neb.phase)

      node.mesh.scale.set(neb.baseScale.x * k, neb.baseScale.y * k, 1)
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
    // breathe makes the streamer field shimmer like a live photosphere;
    // the shared wind level scales the shimmer so storms visibly swell.
    if (node.corona) {
      const co = node.corona

      co.material.rotation = co.phase + s.t * co.rate
      co.material.opacity =
        (0.55 + 0.2 * Math.sin(s.t * (co.rate * 6) + co.phase)) * (0.7 + 0.5 * wind)
    }

    // Limb flares — sin⁴ gives a bright narrow pulse per flare, scaled
    // and stretched by the wind so a storm throws prominences into space.
    if (node.flares) {
      for (const f of node.flares) {
        const k = Math.pow(Math.max(0, Math.sin(s.t * f.rate + f.phase)), 4) * (0.25 + wind)
        const spr = f.sprite as {
          material?: { opacity?: number }
          scale: { set(x: number, y: number, z: number): void }
        }

        if (spr.material) spr.material.opacity = Math.min(1, k)

        const sc = f.base * (SF_SOLAR_WIND.FLARE_MIN_SCALE + SF_SOLAR_WIND.FLARE_MAX_STRETCH * k)

        spr.scale.set(sc, sc, 1)
      }
    }

    // Meteor strikes — airless bodies still take hits: when the schedule
    // elapses, a pooled flash fires at a random surface point (uniform
    // sphere sampling), ramps bright fast, then decays — the impact
    // fireball flash that makes the cratered terrain read as live.
    if (node.meteorPool && node.meteorNext != null) {
      if (s.t >= node.meteorNext) {
        const slot = node.meteorPool.find((m) => !m.active)

        if (slot) {
          // Uniform random point on the sphere — u uniform in cos θ.
          const u = Math.random() * 2 - 1
          const a = Math.random() * Math.PI * 2
          const r = Math.sqrt(1 - u * u)
          const lift = def.radius * 1.02

          slot.sprite.position.set(Math.cos(a) * r * lift, u * lift, Math.sin(a) * r * lift)
          slot.t0 = s.t
          slot.active = true
        }

        node.meteorNext = s.t + SF_METEOR.INTERVAL * (0.4 + Math.random() * 1.2)
      }

      for (const slot of node.meteorPool) {
        if (!slot.active) continue

        const k = (s.t - slot.t0) / SF_METEOR.LIFE
        const mat = slot.sprite as { material?: { opacity?: number } }

        if (k >= 1) {
          slot.active = false

          if (mat.material) mat.material.opacity = 0
        } else if (mat.material) {
          // Fast rise (first 25% of the life), slow decay after — the
          // real fireball profile.
          mat.material.opacity = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75
        }
      }
    }
  }
}
