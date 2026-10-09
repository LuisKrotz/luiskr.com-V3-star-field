/**
 * @file engine/frame.ts
 * @description Per-frame + per-resize behavior for the star-field engine:
 * the self-rescheduling RAF tick (orbit pivots, self-rotation, satellite
 * spins, fly-to tween, approach proximity check, controls damping,
 * render), and the host-aware resize measurer — the canvas lives inside
 * the StarField shadow root so clientWidth comes from the host element.
 */
import { SF_APPROACH, SF_COLORS, SF_LOD, SF_MOTION } from '@core/tokens/starfield/params.js'
import { updateFly } from './fly.js'
import type { SFState } from './types.js'

/** Lazily-armed Vector3 ctor — set by bootstrap after the three import. */
let Vec3: new () => { x: number; y: number; z: number; project?(camera: unknown): unknown }

/** Scratch vector reused by every proximity measurement (no per-frame alloc). */
let _scratch: { x: number; y: number; z: number } | null = null

/** Glaciation-cycle tint colors — armed once by bootstrap (zero alloc). */
let _iceColor: unknown = null
let _warmColor: unknown = null

/**
 * Stores the real Vector3 (+ optional Color) constructors — bootstrap
 * calls this after the lazy three import so frame.ts never imports three
 * itself. The Color pair pre-builds the glaciation tint ramp so the
 * per-frame cycle lerps without allocating.
 * @param V The three.js Vector3 class.
 * @param C The three.js Color class (optional — tests may omit it).
 */
export function armFrame(
  V: typeof Vec3,
  C?: new (hex?: number | string) => { lerpColors(a: never, b: never, k: number): unknown }
): void {
  Vec3 = V
  _scratch = null
  _iceColor = C ? new C(SF_COLORS.EARTH_ICE) : null
  _warmColor = C ? new C(SF_COLORS.SUN_LIGHT) : null
}

/**
 * Projects an anchor's world position into canvas-space pixels for the
 * hover tooltip + leader line — one getWorldPosition → project(camera)
 * → NDC → px pass, all on the shared scratch vector (zero per-frame
 * allocation). Returns null when the anchor or camera isn't projectable
 * (test mocks, unbooted state) or the point sits behind the camera.
 * @param anchor Any Object3D in the scene graph.
 * @param s Engine state (camera + canvas for the projection + size).
 */
export function anchorScreenPos(
  anchor: { getWorldPosition?: (v: never) => { x: number; y: number; z: number } },
  s: SFState
): { x: number; y: number } | null {
  if (!Vec3 || !anchor.getWorldPosition || !s.camera || !s.canvas) return null

  _scratch = _scratch || new Vec3()

  const v = anchor.getWorldPosition(_scratch as never) as {
    x: number
    y: number
    z: number
    project?: (camera: unknown) => { x: number; y: number; z: number }
  }

  if (typeof v.project !== 'function') return null

  const ndc = v.project(s.camera)

  if (ndc.z > 1) return null

  const w = s.canvas.clientWidth
  const h = s.canvas.clientHeight

  if (!w || !h) return null

  return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h }
}

/**
 * World position of an anchor — single getWorldPosition call-site so the
 * armed Vector3 stays private to this module; returns {x,y,z} so callers
 * never handle three types.
 * @param anchor Any Object3D in the scene graph.
 */
export function anchorWorldPos(anchor: {
  getWorldPosition?: (v: never) => { x: number; y: number; z: number }
}): { x: number; y: number; z: number } {
  if (!Vec3 || !anchor.getWorldPosition) return { x: 0, y: 0, z: 0 }

  _scratch = _scratch || new Vec3()

  return anchor.getWorldPosition(_scratch as never)
}

/**
 * Resize step: measures the shadow host first, then the canvas parent,
 * then the window. Pixel ratio caps at 2 to prevent 3x-phone fill-rate
 * blowout.
 * @param s Engine state.
 */
export function handleStarResize(s: SFState): void {
  if (!s.canvas || !s.renderer || !s.camera) return

  const root = s.canvas.getRootNode()

  const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : null

  const w = host?.clientWidth || s.canvas.parentElement?.clientWidth || window.innerWidth

  const h = host?.clientHeight || s.canvas.parentElement?.clientHeight || window.innerHeight

  if (!w || !h) return

  s.camera.aspect = w / h

  s.camera.updateProjectionMatrix()

  const r = s.renderer as { setPixelRatio?(n: number): void; setSize?(w: number, h: number): void }

  r.setPixelRatio?.(Math.min(window.devicePixelRatio, 2))

  r.setSize?.(w, h)
}

/**
 * Proximity check — when the camera comes within a body's approach
 * distance its dossier JSON prefetches via `onApproach`, once per body
 * per session (the `approached` set). Selection prefetches too, so a
 * slow drift-through and a direct nav click share one cache.
 * @param s Engine state.
 */
function checkApproach(s: SFState): void {
  if (!s.camera || !s.onApproach) return

  const cam = s.camera.position

  for (const [id, anchor] of s.anchors) {
    if (s.approached.has(id)) continue

    const def = s.nodes.get(id)?.def

    if (!def) continue

    const p = anchorWorldPos(anchor)

    const dist = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z)

    if (dist < SF_APPROACH.PAD + def.radius * SF_APPROACH.SCALE) {
      s.approached.add(id)

      s.onApproach(id)
    }
  }
}

/**
 * Detail level-of-detail — toggles each node's secondary geometry
 * (shells, satellite pivots, orbit guides) by camera distance so remote
 * bodies draw as one primitive. Orbit radius counts toward `size` so a
 * body's ring stays visible while the camera is still inside it.
 * @param s Engine state.
 */
function updateLod(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  for (const node of s.nodes.values()) {
    if (!node.detail?.length) continue

    const p = anchorWorldPos(node.mesh)

    const dist = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z)

    const size = Math.max(node.def.radius, node.def.orbit ?? 0)

    const near = dist < SF_LOD.PAD + size * SF_LOD.SCALE

    for (const obj of node.detail) {
      obj.visible = near
    }
  }
}

/**
 * Ambient life — the small "alive" behaviors on top of the static chart:
 * `pulse` bodies (variable stars, pulsars, flaring cores) breathe via a
 * sine scale oscillation; `cycle` bodies (Earth's glaciation) lerp the
 * surface tint between the neutral white and the ice-age palette.
 * @param s Engine state.
 */
function updateFx(s: SFState): void {
  for (const node of s.nodes.values()) {
    const def = node.def

    if (def.pulse) {
      const k = 1 + def.pulse.amp * Math.sin((2 * Math.PI * s.t) / def.pulse.period)

      node.mesh.scale.setScalar?.(k)
    }

    if (def.cycle && _iceColor && _warmColor) {
      const holder = node.mesh as {
        material?: { color?: { lerpColors?: (a: never, b: never, k: number) => unknown } }
      }

      const mat = holder.material

      const k = 0.5 + 0.5 * Math.sin((2 * Math.PI * s.t) / def.cycle.period)

      mat?.color?.lerpColors?.(_warmColor as never, _iceColor as never, k)
    }
  }
}

/**
 * Hover tracking — re-projects the hovered anchor each tick and reports
 * canvas-space pixels so the DOM tooltip + leader line track orbiting
 * bodies. Fires nothing when hover is idle (no per-frame DOM churn).
 * @param s Engine state.
 */
function trackHover(s: SFState): void {
  if (!s.hoverId || !s.onHoverMove) return

  const anchor = s.anchors.get(s.hoverId)

  if (!anchor) return

  const pos = anchorScreenPos(anchor, s)

  if (pos) s.onHoverMove(s.hoverId, pos.x, pos.y)
}

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
  if (s.disposed || s.reduced) return

  s.animId = requestAnimationFrame((t) => tickStar(s, t))

  const t = (now ?? performance.now()) / 1000

  const dt = Math.min(0.1, Math.max(0, t - s.lastT))

  s.lastT = t
  s.t += dt

  for (const node of s.nodes.values()) {
    const def = node.def

    if (def.orbit != null && def.speed) {
      node.pivot.rotation.y = (def.phase ?? 0) + s.t * SF_MOTION.ORBIT_SPEED * def.speed
    }

    if (def.spin) {
      node.spinner.rotation.y = s.t * SF_MOTION.SPIN_SPEED * def.spin
    }

    for (const sat of node.satPivots) {
      sat.pivot.rotation.y = sat.phase + s.t * SF_MOTION.ORBIT_SPEED * sat.speed
    }
  }

  updateFly(s)

  checkApproach(s)

  updateLod(s)

  updateFx(s)

  s.controls?.update()

  if (s.renderer && s.scene && s.camera) {
    s.renderer.render(s.scene, s.camera)
  }

  trackHover(s)
}
