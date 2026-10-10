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
 * Raycasts pickables at a pointer position — converts client coords into
 * canvas-relative NDC, then intersects `s.pickables` recursively so shell
 * children resolve to their body's mesh via userData walk-up. Hits that
 * land on oversized invisible pick proxies lose to any real-mesh hit
 * further down the ray, so clicking through a fat proxy bubble still
 * selects the actual body underneath.
 * @returns The hit body id, or null.
 */
function pickAt(s: SFState, clientX: number, clientY: number): string | null {
  const canvas = s.canvas

  if (!canvas || !s.camera || !s.pickables.length) return null

  const rect = canvas.getBoundingClientRect()

  if (!rect.width || !rect.height) return null

  const ndc = {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }

  const raycaster = new RaycasterCtor()

  raycaster.setFromCamera(ndc, s.camera)

  const hits = raycaster.intersectObjects(s.pickables, true) as Array<{
    object: { userData: Record<string, unknown>; parent?: unknown }
  }>

  let proxyId: string | null = null

  for (const hit of hits ?? []) {
    const resolved = hit?.object ? resolveHit(hit.object) : null

    if (!resolved) continue

    if (!resolved.proxy) return resolved.id

    proxyId ??= resolved.id
  }

  return proxyId
}

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

    const id = pickAt(s, pe.clientX, pe.clientY)

    if (id !== s.hoverId) {
      s.hoverId = id

      s.onHover?.(id)
    }
  }

  canvas.addEventListener(POINTER_EVENTS.POINTERDOWN, s.onPointerDown)

  canvas.addEventListener(POINTER_EVENTS.POINTERUP, s.onPointerUp)

  canvas.addEventListener(POINTER_EVENTS.POINTERMOVE, s.onPointerMove)

  s.onWheel = () => {
    s.fly = null
  }

  canvas.addEventListener(MOUSE_EVENTS.WHEEL, s.onWheel)
}
