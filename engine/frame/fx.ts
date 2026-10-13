/**
 * @file engine/frame/fx.ts
 * @description Ambient-life per-frame effects — `pulse` bodies (variable
 * stars, pulsars, flaring cores) breathe via a sine scale oscillation;
 * `cycle` bodies (Earth's glaciation) lerp the surface tint between the
 * armed warm/ice ramp; star corona sprites slowly rotate and shimmer.
 * Split out of frame.ts.
 */
import {
  SF_COMET,
  SF_METEOR,
  SF_NEBULA_DEPTH,
  SF_PLUME,
  SF_SOLAR_WIND,
} from '@core/tokens/starfield/params.js'
import { armed } from './shared.js'
import { SF_USER_GAS } from '../bodies/comet.js'
import type { SFState } from '../types.js'

/**
 * Live particle-sim record stashed on each tail `Points` node's
 * `userData[SF_USER_GAS]` — updateFx reads the seeded per-grain vectors
 * and rewrites `pos`/`col` in place each frame (the buffers are shared
 * with the geometry's BufferAttributes, so `needsUpdate` is the only
 * GPU round-trip; nothing allocates per frame). Bare test fixtures may
 * stub any field — every access is optional-chained and the layer is
 * simply skipped when the record is absent.
 */
interface GasPts {
  pos?: Float32Array
  col?: Float32Array
  aMat?: { needsUpdate: boolean }
  aCol?: { needsUpdate: boolean }
  phase?: Float32Array
  lat?: Float32Array
  latZ?: Float32Array
  rate?: Float32Array
  wobP?: Float32Array
  wobA?: Float32Array
  wobF?: Float32Array
  dim?: Float32Array
  sz?: Float32Array
  psize?: number
  len?: number
  spread?: number
  grow?: number
  rgb?: [number, number, number]
  op?: number
}

/**
 * Quaternion-ish — the scratch shape updateFx needs for the comet
 * billboard math (`invert`, `multiply`). Structural so the three.js
 * mock and the real Quaternion both satisfy it.
 */
interface QuatLike {
  invert(): QuatLike
  multiply(q: QuatLike): QuatLike
}

/**
 * Billboard scratch — per-grain instance matrices are composed as
 * `translate(grain) · orient(camera) · scale(size)`: a tail quad must
 * always face the camera, so its local orientation is the node's
 * inverse world quaternion times the camera's world quaternion. The
 * objects are created lazily off `s.THREE` (the module arrives on the
 * state, not as an import) and reused every frame — zero allocation in
 * the hot loop.
 */
let _mat: { compose(v: unknown, q: unknown, s: unknown): unknown } | undefined
let _vec: { set(x: number, y: number, z: number): unknown } | undefined
let _scl: { setScalar(k: number): unknown } | undefined
let _qN: unknown | undefined
let _qC: unknown | undefined

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

    // Comet tails — sublimation scales steeply with solar flux (≈1/r²),
    // so outgassing ignites only inside a periapsis window: `f` runs 1
    // at rMin and hard-decays to 0 at `rMin + span·ACTIVE_FRAC`, meaning
    // the tails vanish entirely on the outer leg — a comet flying back
    // from apoapsis shows just a dark nucleus under a faint coma, never
    // a phantom streak. `center.position.x` IS the live radius —
    // frame.ts writes `r = a(1−e²)/(1+e·cosθ)` onto it each tick; the
    // tails themselves are parented to `center` where +x is permanently
    // anti-sunward, so only length/opacity need animating.
    if (node.comet) {
      const co = node.comet

      const span = co.rMax - co.rMin
      const r = node.center?.position.x ?? co.rMin
      const rCut = co.rMin + span * SF_COMET.ACTIVE_FRAC

      const f =
        span > 0
          ? Math.pow(
              Math.min(1, Math.max(0, (rCut - r) / Math.max(rCut - co.rMin, 1e-6))),
              SF_COMET.GAMMA
            )
          : 1

      // Tails fully unmount outside the window — no apoapsis ghost.
      const live = f > SF_COMET.TAIL_OFF

      for (const pts of [co.ion, co.dust, co.ionGas, co.dustGas]) {
        ;(pts as { visible?: boolean }).visible = live
      }

      const coma = co.coma as {
        scale: { set(a: number, b: number, c: number): void }
        material?: { opacity?: number }
      }

      /**
       * Particle tails — each layer's `userData.gasPts` holds the
       * seeded grain field; this loop is the emission simulation:
       *
       *   d     = frac(phase[i] + t·rate[i])      — grain age 0→1
       *   x     = d·len                            — anti-sunward drift
       *   y     = lat[i]·sp + sin(wobble)·amp      — lateral fan +
       *                                            plasma turbulence
       *   z     = latZ[i]·sp·ZFLAT                 — thin-sheet depth
       *   sp    = spread·(1 + grow·d)              — solar-wind
       *                                            dispersion fan
       *   color = rgb·smoothstep(d/RAMP)·(1−d)^FADE·dim[i]·windK
       *
       * The `(1−d)^FADE` term makes every grain die at its own
       * distance — the tip dissolves grain-by-grain instead of ending
       * on a line — and vertex-color brightness doubles as alpha under
       * additive blending, so no quad edge exists anywhere in the
       * silhouette. `len`/`sp` scale with the periapsis factor `f`
       * (sublimation ≈ solar flux), and `windK` couples brightness to
       * the shared solar-wind level so storms surge the stream.
       * ~640 grains × a handful of flops — zero allocation.
       */
      const windK = 1 - SF_COMET.WIND_K + (SF_COMET.WIND_K * Math.min(wind, 1.5)) / 1.5

      /**
       * One lazy scratch set for the whole comet section — matrix/quat
       * compose targets shared by every tail layer this frame.
       */
      const T = s.THREE

      if (T && _mat === undefined) {
        _mat = new T.Matrix4()
        _vec = new T.Vector3()
        _scl = new T.Vector3()
        _qN = new T.Quaternion()
        _qC = new T.Quaternion()
      }

      const updateTail = (pts: unknown): void => {
        const p = pts as {
          userData?: Record<string, GasPts | undefined>
          material?: { opacity?: number }
          getWorldQuaternion?: (q: unknown) => unknown
          setMatrixAt?: (i: number, m: unknown) => void
        }
        const ud = p.userData?.[SF_USER_GAS]
        const n = ud?.phase?.length ?? 0

        if (!ud?.pos || !ud.col || !n) return

        const len = (ud.len ?? 0) * f
        const sp0 = (ud.spread ?? 0) * (SF_COMET.WID_FLOOR + (1 - SF_COMET.WID_FLOOR) * f)
        const grow = ud.grow ?? 0
        const rgb = ud.rgb ?? [1, 1, 1]
        const psize = ud.psize ?? 1

        /**
         * Billboard orientation — the quads face the camera in the
         * node's local frame: `local = nodeWorldQuat⁻¹ · camWorldQuat`.
         * Without a live camera/renderer (tests) the grain buffers
         * still update — only the matrix write is skipped.
         */
        const cam = s.camera as
          { quaternion?: QuatLike; getWorldQuaternion?: (q: unknown) => unknown } | null | undefined
        const camQ = (cam?.getWorldQuaternion?.(_qC) ?? cam?.quaternion) as QuatLike | undefined
        const node = p as { getWorldQuaternion?: (q: unknown) => QuatLike }
        let bill: QuatLike | null = null

        if (_mat && _vec && _scl && _qN && camQ && node.getWorldQuaternion && p.setMatrixAt) {
          bill = node.getWorldQuaternion(_qN).invert().multiply(camQ)
        }

        for (let i = 0; i < n; i++) {
          const d = ((ud.phase?.[i] ?? 0) + s.t * (ud.rate?.[i] ?? 0)) % 1
          const sp = sp0 * (1 + grow * d)
          const j = i * 3
          const x = d * len
          const y =
            (ud.lat?.[i] ?? 0) * sp +
            Math.sin(s.t * (ud.wobF?.[i] ?? 0) + (ud.wobP?.[i] ?? 0)) *
              (ud.wobA?.[i] ?? 0) *
              SF_COMET.WOB_AMP *
              sp *
              (0.25 + 0.75 * d)
          const z = (ud.latZ?.[i] ?? 0) * sp * SF_COMET.ZFLAT

          ud.pos[j] = x
          ud.pos[j + 1] = y
          ud.pos[j + 2] = z

          /**
           * Envelope — `smoothstep(0, RAMP, d)` ramps fresh grains in
           * (no pop at the nucleus), `(1−d)^FADE` dissolves them toward
           * the tip, `dim[i]` spreads per-grain brightness, `windK`
           * surges the whole column on solar storms, and `GAIN` pushes
           * overlapping additive grains into saturation so the cloud
           * fuses into a column.
           */
          const rr = Math.min(1, d / SF_COMET.PTS_RAMP)
          const k =
            rr *
            rr *
            (3 - 2 * rr) *
            Math.pow(1 - d, SF_COMET.PTS_FADE) *
            (ud.dim?.[i] ?? 1) *
            windK *
            SF_COMET.GAIN

          ud.col[j] = rgb[0] * k
          ud.col[j + 1] = rgb[1] * k
          ud.col[j + 2] = rgb[2] * k

          /**
           * Instance matrix — the grain's quad swells downstream
           * (`SZ_BASE + SZ_GROW·d`: dispersing gas expands) and carries
           * the seeded size jitter.
           */
          if (bill && _mat && _vec && _scl) {
            const sz = psize * (ud.sz?.[i] ?? 1) * (SF_COMET.SZ_BASE + SF_COMET.SZ_GROW * d)

            _vec.set(x, y, z)
            _scl.setScalar(sz)
            _mat.compose(_vec, bill, _scl)
            p.setMatrixAt?.(i, _mat)
          }
        }

        if (ud.aMat) ud.aMat.needsUpdate = true
        if (ud.aCol) ud.aCol.needsUpdate = true

        if (p.material?.opacity != null) p.material.opacity = (ud.op ?? 1) * f
      }

      // Dead tails skip the sim entirely — the clouds are invisible
      // anyway, so the ~640-grain loop is pure waste outside the
      // periapsis window.
      if (live) {
        updateTail(co.ion)
        updateTail(co.ionGas)
        updateTail(co.dust)
        updateTail(co.dustGas)
      }

      // The coma never fully dies — a dormant nucleus still vents a
      // thin background envelope; it just thins toward apoapsis.
      const ck = SF_COMET.COMA_FLOOR + (1 - SF_COMET.COMA_FLOOR) * f

      coma.scale.set(co.comaScale.x * ck, co.comaScale.y * ck, 1)

      if (coma.material?.opacity != null) coma.material.opacity = SF_COMET.COMA_OPACITY * ck
    }

    // Cryovolcanic plumes — each vent's puff cycles outward along its
    // axis: spawn compact at the surface, rise, expand, fade, recycle;
    // the steady jet cone shimmers at the vent base. Sun gating:
    // `dot(ventDir, sunDirLocal)` drives a smoothstep between SUN_LO
    // and SUN_HI — a vent on the night hemisphere drops to DARK_FLOOR
    // (the plume barely scatters without sunlight), so geysers read on
    // the lit limb the way the Enceladus backscatter images show them.
    // Zero allocation.
    if (node.plumes) {
      for (const pl of node.plumes) {
        const cyc = (s.t * pl.rate + pl.phase) % 1
        const h = pl.radius + cyc * pl.height

        const puff = pl.puff as {
          position: { set(a: number, b: number, c: number): void }
          scale: { set(a: number, b: number, c: number): void }
          material?: { opacity?: number }
        }

        puff.position.set(pl.dir.x * h, pl.dir.y * h, pl.dir.z * h)

        const w = pl.width * (1 + cyc * 1.6)

        puff.scale.set(w, w, 1)

        // Vent sun factor — the shared vector updateDayNight rewrites
        // each frame; absent → assume lit (tests, non-solar bodies).
        const lit = pl.sunDir
          ? Math.min(
              1,
              Math.max(
                0,
                (pl.dir.x * pl.sunDir.x +
                  pl.dir.y * pl.sunDir.y +
                  pl.dir.z * pl.sunDir.z -
                  SF_PLUME.SUN_LO) /
                  (SF_PLUME.SUN_HI - SF_PLUME.SUN_LO)
              )
            )
          : 1

        const shade = SF_PLUME.DARK_FLOOR + (1 - SF_PLUME.DARK_FLOOR) * lit

        if (puff.material?.opacity != null) {
          puff.material.opacity = SF_PLUME.PUFF_OPACITY * (1 - cyc) * cyc * 4 * shade
        }

        const jet = pl.jet as { material?: { opacity?: number } }

        if (jet.material?.opacity != null) {
          jet.material.opacity =
            SF_PLUME.OPACITY * (0.7 + 0.3 * Math.sin(s.t * pl.rate * 9 + pl.phase * 11)) * shade
        }
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
