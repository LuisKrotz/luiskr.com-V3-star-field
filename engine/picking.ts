/**
 * @file engine/picking.ts
 * @description Pointer picking for the star-field canvas: pointerdown
 * records the press point (and cancels any fly-to so manual control
 * wins), pointerup within a small drag threshold raycasts the pickable
 * meshes and selects the hit body, pointermove raycasts a hover state
 * for the HUD. All events route through `pointer*` so mouse, touch and
 * pen share one code path.
 */
import { MOUSE_EVENTS, POINTER_EVENTS } from '@core/tokens/events/dom.js'
import { INPUT_STRINGS } from '@core/tokens/strings/input.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import type { SFState } from './types.js'
import { SF_USER_BODY, SF_USER_PROXY } from './bodies-scene.js'

/** Max pointer travel (px) still counted as a click, not an orbit drag. */
const CLICK_DRAG_PX = 8

/**
 * Walks a hit object up its ancestor chain until a `userData.bodyId`
 * appears — raycast hits land on child detail (cloud shells, rings,
 * halos, satellite pivots) that carry no id, so the owning body is the
 * nearest tagged ancestor. Returns the id and whether the originally
 * hit object was an oversized invisible pick proxy.
 * @param object The raycast hit object.
 * @returns `{ id, proxy }` or null when no ancestor carries a body id.
 */
function resolveHit(object: {
  userData: Record<string, unknown>
  parent?: unknown
}): { id: string; proxy: boolean } | null {
  const proxy = object.userData[SF_USER_PROXY] === true

  let node = object as { userData: Record<string, unknown>; parent?: unknown } | undefined

  while (node) {
    const id = node.userData?.[SF_USER_BODY]

    if (typeof id === 'string') return { id, proxy }

    node = node.parent as { userData: Record<string, unknown>; parent?: unknown } | undefined
  }

  return null
}

/**
 * Walks a hit object's ancestor chain — three.js raycasts don't cull
 * `visible: false` objects, so a deep-tier body gated off by the LOD
 * tier reveal would still hover/pick through its hidden pivot.
 * @param object The raycast hit object (may be a deep child).
 * @returns false when any ancestor is hidden.
 */
function chainVisible(object: { visible?: boolean; parent?: unknown } | null | undefined): boolean {
  let node: { visible?: boolean; parent?: unknown } | null | undefined = object

  while (node) {
    if (node.visible === false) return false

    node = node.parent as { visible?: boolean; parent?: unknown } | null | undefined
  }

  return true
}

/**
 * Raycasts pickables at a pointer position — converts client coords into
 * canvas-relative NDC, then intersects `s.pickables` recursively so shell
 * children resolve to their body's mesh via userData walk-up. Hits that
 * land on oversized invisible pick proxies lose to any real-mesh hit
 * further down the ray, and between OVERLAPPING proxies the smallest
 * authored radius wins — a moon's tight bubble beats the giant planet
 * bubble it orbits inside (the Moon stays clickable over Earth).
 * @returns The hit body id, or null.
 */
function pickAt(s: SFState, clientX: number, clientY: number): string | null {
  const canvas = s.canvas

  if (!canvas || !s.camera || !s.pickables.length) return null

  const rect = canvas.getBoundingClientRect()

  if (!rect.width || !rect.height) return null

  // Pooled NDC vector + raycaster — mutating preallocated objects keeps
  // the hover tick allocation-free (per-frame GC churn stalls 240Hz).
  PICK_NDC.x = ((clientX - rect.left) / rect.width) * 2 - 1
  PICK_NDC.y = -((clientY - rect.top) / rect.height) * 2 + 1

  if (!sharedRaycaster) sharedRaycaster = new RaycasterCtor()

  sharedRaycaster.setFromCamera(PICK_NDC, s.camera)

  const raycaster = sharedRaycaster

  const hits = raycaster.intersectObjects(s.pickables, true) as Array<{
    object: { userData: Record<string, unknown>; parent?: unknown }
  }>

  let proxyId: string | null = null
  let proxyR = Infinity

  for (const hit of hits ?? []) {
    if (!chainVisible(hit?.object)) continue

    const resolved = hit?.object ? resolveHit(hit.object) : null

    if (!resolved) continue

    if (!resolved.proxy) return resolved.id

    // Smallest body wins among overlapping proxy bubbles — a moon's
    // tight pick sphere must beat the host planet's giant one when the
    // ray crosses both.
    const r = s.nodes.get(resolved.id)?.def.radius ?? Number.MAX_VALUE

    if (r < proxyR) {
      proxyR = r
      proxyId = resolved.id
    }
  }

  return proxyId
}

/** Pooled NDC vector reused by every pick — one allocation, ever. */
const PICK_NDC = { x: 0, y: 0 }

/** Pooled raycaster instance — intersectObjects re-runs on it per frame. */
let sharedRaycaster: {
  setFromCamera(ndc: { x: number; y: number }, cam: unknown): void
  intersectObjects(objs: unknown[], recursive: boolean): unknown
} | null = null

/** Set by bootstrap — the lazily imported Raycaster class. */
let RaycasterCtor: new () => {
  setFromCamera(ndc: { x: number; y: number }, cam: unknown): void
  intersectObjects(objs: unknown[], recursive: boolean): unknown
}

/**
 * Stores the Raycaster constructor — bootstrap calls this after the lazy
 * three import so picking.ts never imports three itself (tree-shakeable,
 * test-mockable).
 */
export function armPicking(Raycaster: typeof RaycasterCtor): void {
  RaycasterCtor = Raycaster

  // Re-arming swaps the class (tests, backend retries) — drop the pooled
  // instance so the next pick rebuilds from the new constructor.
  sharedRaycaster = null
}

/**
 * Binds the pointer listeners on the render canvas: down records origin +
 * cancels fly, up-within-threshold selects, move updates hover. Listeners
 * live in state so destroy() can detach them all.
 * @param s Engine state.
 */
export function bindPicking(s: SFState): void {
  const canvas = s.canvas

  if (!canvas) return

  s.onPointerDown = (e: Event) => {
    const pe = e as PointerEvent

    s.downXY = { x: pe.clientX, y: pe.clientY }

    s.fly = null
  }

  s.onPointerUp = (e: Event) => {
    const pe = e as PointerEvent

    const down = s.downXY

    s.downXY = null

    if (down) {
      const moved = Math.hypot(pe.clientX - down.x, pe.clientY - down.y)

      if (moved > CLICK_DRAG_PX) return
    }

    const id = pickAt(s, pe.clientX, pe.clientY)

    if (id) s.onSelect?.(id)
  }

  s.onPointerMove = (e: Event) => {
    const pe = e as PointerEvent

    // High-rate input: 1000Hz+ mice deliver several moves per frame —
    // keep only the freshest coalesced sample (hover needs the last
    // position), then raycast once per frame on the rAF tick below.
    const coalesced = pe.getCoalescedEvents?.()
    const last = coalesced && coalesced.length ? coalesced[coalesced.length - 1] : pe

    s.pickX = last.clientX
    s.pickY = last.clientY

    if (s.pickRaf !== null) return

    s.pickRaf = requestAnimationFrame(() => {
      s.pickRaf = null

      if (s.disposed || !canvas.isConnected) return

      const id = pickAt(s, s.pickX, s.pickY)

      // Pickable → glove cursor; empty space → default. The canvas owns
      // the style so OrbitControls' own cursor rules never fight it.
      canvas.style.cursor = id ? INPUT_STRINGS.POINTER : CHAR_STRINGS.EMPTY

      if (id !== s.hoverId) {
        s.hoverId = id

        s.onHover?.(id)
      }
    })
  }

  canvas.addEventListener(POINTER_EVENTS.POINTERDOWN, s.onPointerDown, { passive: true })

  canvas.addEventListener(POINTER_EVENTS.POINTERUP, s.onPointerUp, { passive: true })

  canvas.addEventListener(POINTER_EVENTS.POINTERMOVE, s.onPointerMove, { passive: true })

  s.onWheel = () => {
    s.fly = null
  }

  canvas.addEventListener(MOUSE_EVENTS.WHEEL, s.onWheel, { passive: true })
}
