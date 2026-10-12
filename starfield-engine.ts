/**
 * @file starfield-engine.ts
 * @description Facade for the star-field three.js engine — owns the SFState
 * bag and exposes the lifecycle surface the StarField component drives:
 * init() → bootstrap (single onReady fire point even on bailouts, like
 * the earth engine), selectBody/flyHome camera control, takeScreenshot,
 * setReducedMotion pause/resume, destroy() releasing listeners, RAF and
 * the renderer.
 *
 * Public API:
 *   init()               → async bootstrap
 *   selectBody(id)       → fly to body + onSelect(id)
 *   flyHome()            → return to the overview pose
 *   takeScreenshot()     → download PNG
 *   setReducedMotion(b)  → pause/resume RAF
 *   get failed           → bootstrap bailed — host shows CSS fallback
 *   destroy()
 */
import { POINTER_EVENTS, MOUSE_EVENTS, WINDOW_EVENTS } from '@core/tokens/events/dom.js'
import { SF_BODY_IDS, SF_CAMERA, SF_STAR_CLOUD, SF_ZOOM } from '@core/tokens/starfield/params.js'
import { isRegistryId, loadRegistryRecord, registryWorldPos } from './engine/registry.js'
import { disposeRegistryBodies, ensureRegistryBody } from './engine/registry-body.js'
import type { SFRegistryRecord } from './engine/registry.js'
import { bootstrapStarField } from './engine/bootstrap.js'
import { anchorWorldPos, rotateStarCamera, tickStar } from './engine/frame.js'
import { startFly } from './engine/fly.js'
import { followSelected } from './engine/frame/camera.js'
import { takeStarScreenshot } from './engine/screenshot.js'
import { createStarState, type SFEvents } from './engine/state.js'
import { disposeStarCloud } from './engine/star-cloud.js'
import type { SFState } from './engine/types.js'
import { devError } from '@core/devlog.js'

/**
 * Owns the full star-field scene: renderer, camera rig, skybox, catalog
 * body graph, raycast picking, fly-to tweens and the RAF loop. The host
 * component reads `failed` to swap in the CSS fallback surface.
 */
export class StarFieldEngine {
  /** All mutable engine state — see engine/state.ts. */
  #s: SFState

  constructor(canvas: HTMLCanvasElement, events: SFEvents = {}) {
    this.#s = createStarState(canvas, events)
  }

  /**
   * Async bootstrap — catches throws, marks failed when the scene never
   * assembled (silent bailouts included), and always fires onReady so the
   * loader can never stick. Same contract as EarthBackground.init().
   */
  async init(): Promise<void> {
    const s = this.#s

    try {
      await bootstrapStarField(s)
    } catch (e) {
      devError('[StarField] Bootstrap failed:', e)
      s.failed = true
    }

    if (s.disposed) return

    // A missing scene means boot bailed before assembly — flag it so the
    // host swaps in the CSS fallback instead of a dead canvas.
    if (!s.scene) s.failed = true

    s.onReady?.()
  }

  /** True when bootstrap bailed or threw before the scene assembled. */
  get failed(): boolean {
    return this.#s.failed
  }

  /**
   * Pause/resume the render loop for prefers-reduced-motion — the last
   * frame stays on screen (preserveDrawingBuffer), so pausing never
   * blanks the scene.
   */
  setReducedMotion(reduced: boolean): void {
    const s = this.#s

    s.reduced = reduced

    if (reduced) {
      if (s.animId) {
        cancelAnimationFrame(s.animId)

        s.animId = null
      }
    } else if (!s.animId && s.renderer) {
      tickStar(s)
    }
  }

  /**
   * Flies the camera to a body — catalog slugs resolve through the
   * anchors map; registry ids (`star-NNNNNN`…) resolve through the
   * shard index to their true heliocentric position. Called by the host
   * for both nav picks and canvas raycast picks — `onSelect` is only
   * fired by the pointer path (picking.ts) so selection never loops.
   * @param id Catalog body id or registry id.
   */
  selectBody(id: string): void {
    const s = this.#s

    if (isRegistryId(id)) {
      s.selectedId = id

      // Registry stars live in the heliocentric cloud on the galactic
      // rider — they have no anchor of their own, so keep the camera
      // pinned to the current frame anchor (Sun fallback) or the cloud's
      // ride sweeps the picked star out of frame within a second.
      if (!s.followId || !s.anchors.has(s.followId)) {
        s.followId = s.anchors.has(SF_BODY_IDS.SUN) ? SF_BODY_IDS.SUN : null
      }

      // Async shard resolve → fly — fire-and-forget with a selection
      // guard so a fast second select can't have a slow first response
      // hijack the camera.
      void loadRegistryRecord(id).then((rec) => {
        if (s.disposed || s.selectedId !== id || !rec || !s.camera) return

        // Materialize the record's real body — textured star disc,
        // procedural exoplanet or DSO speckle cloud — at its catalogued
        // position before the camera glides onto it, so the arrival
        // lands on a resolved object, not an empty point of light.
        ensureRegistryBody(s, rec)

        startFly(s, () => registryWorldPos(s, rec), SF_STAR_CLOUD.FLY_OFFSET)
      })

      return
    }

    const anchor = s.anchors.get(id)

    const def = s.nodes.get(id)?.def

    if (!anchor || !def || !s.camera) return

    s.selectedId = id
    s.followId = id

    // Repin the world on the new anchor before the tween arms: `track()`
    // then resolves inside the pinned frame, so the glide covers only
    // the local gap — same-plane picks (Moon/Jupiter neighbours) just
    // slide sideways instead of zooming out across the galactic span.
    followSelected(s)

    const offset = Math.max(def.radius * SF_ZOOM.STANDOFF, SF_ZOOM.STANDOFF_MIN)

    startFly(s, () => anchorWorldPos(anchor), offset)
  }

  /**
   * Navigator-hover position hint — arms the hint record for the row
   * under the pointer/focus so `trackHover` reports the body's
   * projected (edge-clamped) screen position every tick: the hint
   * locates the object at any zoom level, on- or off-screen. Catalog
   * ids store their anchor (live world position); registry rows store
   * their shard record so the static shard point resolves in the
   * pinned frame. Also echoes `onHover` so the tooltip label +
   * aria-live announce populate the same way canvas hover does.
   * Pass null to clear.
   * @param id Hovered body id, or null to clear the hint.
   * @param rec Registry record when `id` is a shard id (star-NNNNNN…).
   */
  setHint(id: string | null, rec?: SFRegistryRecord): void {
    const s = this.#s

    if (!id) {
      s.hint = null

      s.onHover?.(null)

      return
    }

    const anchor = s.anchors.get(id)

    if (!anchor?.getWorldPosition && !rec) return

    s.hint = { id, anchor: anchor ?? null, rec: rec ?? null }

    s.onHover?.(id)
  }

  /**
   * Arrow-key orbit — rotates the camera around the controls target in
   * screen-intuitive steps: left/right change azimuth, up/down change
   * polar (clamped off the poles). Pure spherical math on the offset
   * vector — no three types needed, and any running fly-to is cancelled
   * so manual control wins.
   * @param dAzimuth Azimuth delta in radians (left = -, right = +).
   * @param dPolar Polar delta in radians (down = -, up = +).
   */
  rotateView(dAzimuth: number, dPolar: number): void {
    rotateStarCamera(this.#s, dAzimuth, dPolar)
  }

  /**
   * Releases the selection without moving the camera — stops the
   * per-frame orbit-follow when the dossier panel closes, so the chart
   * is no longer glued to the body the user dismissed.
   */
  deselect(): void {
    this.#s.selectedId = null
    this.#s.followId = null
  }

  /**
   * Overview — glides to the solar-system vantage: the camera tracks the
   * Sun anchor's live position (it rides the rotating galactic disc, so a
   * fixed target would strand the view on empty space) at the HOME
   * standoff, which frames the tier out to the Kuiper belt. Falls back
   * to the scene origin only while anchors are unavailable.
   */
  flyHome(): void {
    const s = this.#s

    s.selectedId = null

    const sun = s.anchors.get(SF_BODY_IDS.SUN)

    s.followId = sun ? SF_BODY_IDS.SUN : null

    // Pin the Sun at the origin before the tween arms so the overview
    // glide resolves in the pinned frame (see selectBody).
    followSelected(s)

    startFly(
      s,
      sun
        ? () => anchorWorldPos(sun)
        : () => ({ x: SF_CAMERA.TARGET_X, y: SF_CAMERA.TARGET_Y, z: SF_CAMERA.TARGET_Z }),
      Math.max(Math.hypot(SF_CAMERA.HOME_X, SF_CAMERA.HOME_Y, SF_CAMERA.HOME_Z), 1)
    )
  }

  /** Downloads the current frame as a PNG. */
  takeScreenshot(): void {
    takeStarScreenshot(this.#s)
  }

  /** Tears down listeners, RAF, controls and the renderer. */
  destroy(): void {
    const s = this.#s

    s.disposed = true

    if (s.animId) {
      cancelAnimationFrame(s.animId)

      s.animId = null
    }

    const canvas = s.canvas

    if (canvas) {
      if (s.onPointerDown) canvas.removeEventListener(POINTER_EVENTS.POINTERDOWN, s.onPointerDown)
      if (s.onPointerMove) canvas.removeEventListener(POINTER_EVENTS.POINTERMOVE, s.onPointerMove)
      if (s.onPointerUp) canvas.removeEventListener(POINTER_EVENTS.POINTERUP, s.onPointerUp)
      if (s.onWheel) canvas.removeEventListener(MOUSE_EVENTS.WHEEL, s.onWheel)
    }

    if (s.onResize) window.removeEventListener(WINDOW_EVENTS.RESIZE, s.onResize)

    disposeStarCloud(s)

    disposeRegistryBodies(s)

    s.controls?.dispose()

    // Post chain first — its render targets + node graph reference the
    // renderer, so it must go before the renderer tears down its device.
    s.pipeline?.dispose()

    s.pipeline = null

    s.renderer?.dispose()

    s.renderer = null
    s.scene = null
    s.camera = null
    s.controls = null
  }
}
