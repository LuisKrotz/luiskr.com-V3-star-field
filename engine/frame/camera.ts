/**
 * @file engine/frame/camera.ts
 * @description Camera-side per-frame behavior — world/screen anchor
 * projection (shared scratch vector, zero alloc), arrow-key orbit
 * rotation, host-aware resize measuring, and the selected-body orbit
 * follower. Split out of frame.ts.
 */
import { SF_CAMERA, SF_KEYS, SF_TIP } from '@core/tokens/starfield/params.js'
import { armed } from './shared.js'
import type { SFState } from '../types.js'

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
  if (!armed.vec3 || !anchor.getWorldPosition || !s.camera || !s.canvas) return null

  armed.scratch = armed.scratch || new armed.vec3()

  const v = anchor.getWorldPosition(armed.scratch as never) as {
    x: number
    y: number
    z: number
    project?: (camera: unknown) => { x: number; y: number; z: number }
  }

  const project = v.project as
    ((camera: unknown) => { x: number; y: number; z: number }) | undefined

  if (!project) return null

  const ndc = project.call(v, s.camera)

  if (ndc.z > 1) return null

  const w = s.canvas.clientWidth
  const h = s.canvas.clientHeight

  if (!w || !h) return null

  return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h }
}

/**
 * Projects a raw world point into canvas-space pixels — the projection
 * backing for the navigator-hover position hint. Unlike
 * `anchorScreenPos` (which bails when the body leaves the view frustum),
 * this always returns a usable position: behind-camera points are
 * mirrored through the screen centre so the clamp lands on the edge
 * facing the object, and any off-screen result is clamped inside
 * `SF_TIP.EDGE_PAD` — the hint therefore locates the body at any zoom
 * level. `edge` reports the clamp and `angle` the outward direction in
 * degrees (canvas coords, y-down) for the leader-line arrow.
 * @param p World-space point (pinned-frame coords).
 * @param s Engine state (camera + canvas for the projection + size).
 */
export function worldScreenPos(
  p: { x: number; y: number; z: number } | null,
  s: SFState
): { x: number; y: number; edge: boolean; angle?: number } | null {
  if (!p || !armed.vec3 || !s.camera || !s.canvas) return null

  armed.scratch = armed.scratch || new armed.vec3()

  const v = armed.scratch as {
    x: number
    y: number
    z: number
    set?: (x: number, y: number, z: number) => void
    project?: (camera: unknown) => { x: number; y: number; z: number }
  }

  if (v.set) v.set(p.x, p.y, p.z)
  else {
    v.x = p.x
    v.y = p.y
    v.z = p.z
  }

  const ndc = v.project?.(s.camera)

  if (!ndc) return null

  const w = s.canvas.clientWidth
  const h = s.canvas.clientHeight

  if (!w || !h) return null

  // Behind the camera the NDC flips sign — mirroring x/y places the
  // clamped edge on the side that actually faces the object.
  const behind = ndc.z > 1

  let nx = ndc.x
  let ny = ndc.y

  if (behind) {
    nx = -nx
    ny = -ny
  }

  let px = ((nx + 1) / 2) * w
  let py = ((1 - ny) / 2) * h

  const rawX = px
  const rawY = py

  let edge = behind

  if (px < SF_TIP.EDGE_PAD) {
    px = SF_TIP.EDGE_PAD
    edge = true
  } else if (px > w - SF_TIP.EDGE_PAD) {
    px = w - SF_TIP.EDGE_PAD
    edge = true
  }

  if (py < SF_TIP.EDGE_PAD) {
    py = SF_TIP.EDGE_PAD
    edge = true
  } else if (py > h - SF_TIP.EDGE_PAD) {
    py = h - SF_TIP.EDGE_PAD
    edge = true
  }

  // Outward direction for the leader-line arrow — from the clamped
  // marker toward the raw projected point (the object's side).
  const angle = edge ? (Math.atan2(rawY - py, rawX - px) * 180) / Math.PI : undefined

  return { x: px, y: py, edge, angle }
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
  if (!armed.vec3 || !anchor.getWorldPosition) return { x: 0, y: 0, z: 0 }

  armed.scratch = armed.scratch || new armed.vec3()

  return anchor.getWorldPosition(armed.scratch as never)
}

/**
 * Arrow-key orbit — rotates the camera around the controls target in
 * screen-intuitive steps: left/right change azimuth, up/down change
 * polar (clamped off the poles so the view can never flip over the top).
 * Pure spherical math on the offset vector — no three types needed —
 * and any running fly-to is cancelled so manual control always wins.
 * The offset is converted to spherical coordinates (r, θ azimuth in the
 * XZ plane, φ polar from +Y), the deltas are applied, then converted
 * back to Cartesian around the target.
 * @param s Engine state (camera + controls required; no-op before boot).
 * @param dAzimuth Azimuth delta in radians (left = -, right = +).
 * @param dPolar Polar delta in radians (down = -, up = +).
 */
export function rotateStarCamera(s: SFState, dAzimuth: number, dPolar: number): void {
  if (!s.camera || !s.controls) return

  s.fly = null

  const tgt = s.controls.target
  const cam = s.camera.position

  // Spherical offset of the camera from the orbit target.
  const ox = cam.x - tgt.x
  const oy = cam.y - tgt.y
  const oz = cam.z - tgt.z

  const r = Math.hypot(ox, oy, oz)

  // Degenerate camera-on-target — no direction to rotate around.
  if (!r) return

  // φ (polar angle from +Y): clamped just off the poles so acos/sin
  // stay well-conditioned and the view can't flip over the zenith.
  const phi = Math.min(
    Math.PI - SF_KEYS.PHI_MIN,
    Math.max(SF_KEYS.PHI_MIN, Math.acos(oy / r) - dPolar)
  )

  // θ (azimuth in the XZ plane, measured from +Z toward +X).
  const theta = Math.atan2(ox, oz) + dAzimuth

  const sinPhi = Math.sin(phi)

  cam.set(
    tgt.x + r * sinPhi * Math.sin(theta),
    tgt.y + r * Math.cos(phi),
    tgt.z + r * sinPhi * Math.cos(theta)
  )

  s.controls.update()
}

/**
 * Resize step: measures the shadow host first, then the canvas parent,
 * then the window. Pixel ratio caps at 2 to prevent 3x-phone fill-rate
 * blowout.
 * @param s Engine state.
 */
export function handleStarResize(s: SFState): void {
  if (!s.canvas || !s.renderer || !s.camera) return

  // The canvas element's own box — the chart renders inside a framed,
  // grid-tracked rect now, so sizing to the host would stretch the
  // framebuffer across the gutters.
  const w = s.canvas.clientWidth || s.canvas.parentElement?.clientWidth || window.innerWidth

  const h = s.canvas.clientHeight || s.canvas.parentElement?.clientHeight || window.innerHeight

  if (!w || !h) return

  s.camera.aspect = w / h

  s.camera.updateProjectionMatrix()

  const r = s.renderer as { setPixelRatio?(n: number): void; setSize?(w: number, h: number): void }

  r.setPixelRatio?.(Math.min(window.devicePixelRatio, 2))

  r.setSize?.(w, h)
}

/**
 * Orbit-follow — keeps the followed anchor pinned at the world origin by
 * counter-translating `s.world` (the floating origin). Rider-mounted
 * bodies translate ~16k units/s on the galactic ring; riding them by
 * translating the camera would push every coordinate to ~6.7M where
 * float32 quantization (±0.5 units) makes each mesh visibly jitter.
 * Shifting the world instead of the camera yields identical relative
 * motion — the user's orbit/zoom offset is preserved because neither
 * camera nor target moves — while rendered coordinates stay small.
 * Runs before `updateFly` each tick so the tween's `track()` resolves
 * inside the pinned frame (select→glide becomes a local move, not a
 * galactic transit). The controls target snaps to the pin only once no
 * fly tween owns it, so orbiting still circles the body while the
 * tween's own target lerp stays free to pan.
 * Registry ids carry no anchor — they are static shard points — and are
 * skipped. Runs every tick (not just post-fly) so the repin lands the
 * same frame a new follow is armed.
 * @param s Engine state.
 */
export function followSelected(s: SFState): void {
  const followId = s.followId ?? s.selectedId

  if (!followId || !s.world || !s.controls) return

  const anchor = s.anchors.get(followId)

  if (!anchor?.getWorldPosition) return

  // `p` already includes the current world shift, so the new shift is
  // `shift + (PIN − p)` — one exact step, no per-frame lag.
  const p = anchorWorldPos(anchor)

  const wp = s.world.position

  wp.set(
    wp.x - p.x + SF_CAMERA.TARGET_X,
    wp.y - p.y + SF_CAMERA.TARGET_Y,
    wp.z - p.z + SF_CAMERA.TARGET_Z
  )

  if (!s.fly) {
    s.controls.target.set(SF_CAMERA.TARGET_X, SF_CAMERA.TARGET_Y, SF_CAMERA.TARGET_Z)
  }
}
