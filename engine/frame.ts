/**
 * @file engine/frame.ts
 * @description Per-frame + per-resize behavior for the star-field engine:
 * the self-rescheduling RAF tick (orbit pivots, self-rotation, satellite
 * spins, fly-to tween, approach proximity check, controls damping,
 * render), and the host-aware resize measurer — the canvas lives inside
 * the StarField shadow root so clientWidth comes from the host element.
 */
import {
  SF_APPROACH,
  SF_COLORS,
  SF_KEYS,
  SF_LOD,
  SF_MOTION,
  SF_SCENE,
  SF_SPIRAL,
  SF_STRUCTURE,
} from '@core/tokens/starfield/params.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { updateFly } from './fly.js'
import { devError } from '@core/devlog.js'
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
 * (shells, satellite pivots) by camera distance so remote
 * bodies draw as one primitive. Orbit radius counts toward `size` so a
 * body's ring stays visible while the camera is still inside it.
 * @param s Engine state.
 */
function updateLod(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  // The deep-tier gate keys on how far the CAMERA is from the solar
  // barycenter, not the body: while the camera orbits inside the local
  // bubble the galactic centre, external galaxies and hierarchy shells
  // would render beside the solar system as if they were neighbors.
  const camHome = Math.hypot(cam.x, cam.y, cam.z)
  const deepOn = camHome > SF_LOD.DEEP_REVEAL

  for (const node of s.nodes.values()) {
    const def = node.def

    const deep =
      def.kind === SF_KINDS.BLACK_HOLE ||
      def.kind === SF_KINDS.STRUCTURE ||
      ((def.kind === SF_KINDS.GALAXY || def.kind === SF_KINDS.DWARF_GALAXY) &&
        !def.spiralDisc?.volumetric)

    if (deep && !deepOn) {
      node.pivot.visible = false
      continue
    }

    node.pivot.visible = true

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
 * Cosmic-hierarchy shell fade — hides the inside of every boundary bubble
 * while the camera is deep within it. A huge fresnel shell viewed from
 * the interior paints a bright silhouette over the whole sky (the giant
 * cream-ball bug), so each structure's shell ramps to visible only once
 * the camera has pulled back to 1.25–1.7× its radius.
 * @param s Engine state.
 */
function updateStructures(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  for (const node of s.nodes.values()) {
    if (node.def.kind !== 'structure') continue

    const p = anchorWorldPos(node.mesh)

    const d = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z)
    const r = node.def.structure?.radius ?? node.def.radius

    // 0 when deep inside, 1 once the camera has pulled back past the shell.
    const fade = smoothstep(r * SF_STRUCTURE.FADE_IN, r * SF_STRUCTURE.FADE_OUT, d)

    const fadeUniform = node.mesh.userData?.fade

    if (fadeUniform) fadeUniform.value = fade

    const speckleMat = node.mesh.userData?.speckleMat as { opacity?: number } | null

    if (speckleMat) {
      // Keep a whisper of member galaxies visible from the inside, ramp
      // to full opacity when the shell itself is visible.
      speckleMat.opacity = SF_STRUCTURE.SPECKLE_OPACITY * (0.45 + 0.55 * fade)
    }
  }
}

/**
 * Volumetric galaxy cloud fade — the Milky Way's particle disc is
 * viewed from inside. Without distance attenuation the hundreds of
 * thousands of additive points stack into an opaque glowing ball that
 * swallows the view; fade them down while the camera is embedded, and
 * ramp up as the camera pulls back far enough to read the disc as a
 * whole. Only volumetric clouds carry the marker.
 * @param s Engine state.
 */
function updateGalaxyClouds(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  for (const node of s.nodes.values()) {
    if (!node.def.spiralDisc?.volumetric) continue

    const p = anchorWorldPos(node.mesh)

    const dx = cam.x - p.x
    const dy = cam.y - p.y
    const dz = cam.z - p.z
    const dist = Math.hypot(dx, dy, dz)
    const r = node.def.radius

    // Fade 0 while deep inside the disc, ramp to 1 once outside ~0.85r.
    // Squaring the smoothstep keeps the interior much darker so the
    // embedded Milky Way reads as a faint band, not an opaque glowing ball.
    const fade = smoothstep(r * 0.25, r * 0.85, dist) ** 2

    const points = node.mesh.children.find((c) => c.userData?.volumetric) as
      { material?: { opacity?: number } } | undefined

    if (points?.material) {
      points.material.opacity = SF_SPIRAL.VOLUMETRIC_OPACITY * (0.2 + 0.8 * fade)
    }
  }
}

/**
 * Orbit-follow — while a catalog body is selected and no fly tween is
 * running, the camera rides with the body: the anchor's new world
 * position is diffed against the controls target, then BOTH the target
 * and the camera translate by that delta, so the user's orbit/zoom
 * offset is preserved while the body keeps moving (a clicked planet
 * never drifts out of frame mid-orbit). Registry ids carry no anchor —
 * they are static shard points — and are skipped.
 * @param s Engine state.
 */
function followSelected(s: SFState): void {
  if (s.fly || !s.selectedId || !s.camera || !s.controls) return

  const anchor = s.anchors.get(s.selectedId)

  if (!anchor?.getWorldPosition) return

  const p = anchorWorldPos(anchor)

  const tgt = s.controls.target

  const dx = p.x - tgt.x
  const dy = p.y - tgt.y
  const dz = p.z - tgt.z

  if (!dx && !dy && !dz) return

  tgt.set(tgt.x + dx, tgt.y + dy, tgt.z + dz)

  const cam = s.camera.position

  cam.set(cam.x + dx, cam.y + dy, cam.z + dz)
}

/** Local smoothstep helper — mirrors GLSL, no dependency on three.js. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))

  return t * t * (3 - 2 * t)
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

    // Star corona — slow in-plane rotation plus a subtle brightness
    // breathe makes the streamer field shimmer like a live photosphere.
    if (node.corona) {
      const co = node.corona

      co.material.rotation = co.phase + s.t * co.rate
      co.material.opacity = 0.55 + 0.2 * Math.sin(s.t * (co.rate * 6) + co.phase)
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
    }

    if (def.spin) {
      node.spinner.rotation.y = s.t * SF_MOTION.SPIN_SPEED * def.spin
    }

    for (const sat of node.satPivots) {
      sat.pivot.rotation.y = sat.phase + s.t * SF_MOTION.ORBIT_SPEED * sat.speed
    }
  }

  updateFly(s)

  followSelected(s)

  checkApproach(s)

  updateLod(s)

  updateStructures(s)

  updateGalaxyClouds(s)

  updateFx(s)

  s.controls?.update()

  if (s.renderer && s.scene && s.camera) {
    s.renderer.render(s.scene, s.camera)
  }

  trackHover(s)
}
