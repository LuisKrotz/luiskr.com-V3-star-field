/**
 * @file engine/state.ts
 * @description Factory for the star-field engine state bag — one mutable
 * SFState threaded through bootstrap/frame/fly/picking so every stage
 * shares the renderer, scene graph, tween and dispose flags. Mirrors the
 * earth engine's `createEarthState` convention.
 */

import type { SFBodyFn, SFProgressFn, SFState } from './types.js'

/** Lifecycle callbacks the host component wires in at construction. */
export interface SFEvents {
  onReady?: () => void
  onProgress?: SFProgressFn
  onSelect?: SFBodyFn
  onApproach?: SFBodyFn
  onHover?: (bodyId: string | null) => void
  onHoverMove?: (bodyId: string, x: number, y: number) => void
  /**
   * Fired once when a frame throws — the render loop stops and the host
   * swaps in the 2D fallback instead of leaving a dead canvas.
   */
  onLost?: () => void
}

/**
 * Builds the initial engine state — everything null/empty until bootstrap
 * fills it; `disposed`/`failed`/`reduced` are the flags every async stage
 * re-checks before touching the scene.
 * @param canvas Persistent canvas the host renders into.
 * @param events Host callbacks (ready/progress/select/approach/hover).
 * @returns Fresh SFState.
 */
export function createStarState(canvas: HTMLCanvasElement, events: SFEvents = {}): SFState {
  return {
    canvas,
    renderer: null,
    pipeline: null,
    scene: null,
    world: null,
    sunLight: null,
    camera: null,
    controls: null,
    nodes: new Map(),
    anchors: new Map(),
    pickables: [],

    dayNight: [],

    approached: new Set(),
    solarWind: null,
    fxTime: null,
    starCloud: null,
    starCloudLoading: false,
    THREE: null,
    deps: null,
    glowTex: null,
    registryBodies: new Map(),
    fly: null,
    animId: null,
    disposed: false,
    failed: false,
    reduced: false,
    onResize: null,
    onPointerDown: null,
    onPointerMove: null,
    onPointerUp: null,
    onWheel: null,
    downXY: null,
    pickX: 0,
    pickY: 0,
    pickRaf: null,
    viewW: 0,
    viewH: 0,
    lastT: 0,
    t: 0,
    predictor: null,
    appliedQuality: 1,
    hoverId: null,
    hint: null,
    selectedId: null,
    followId: null,
    onReady: events.onReady,
    onProgress: events.onProgress,
    onSelect: events.onSelect,
    onApproach: events.onApproach,
    onHover: events.onHover,
    onHoverMove: events.onHoverMove,
    onLost: events.onLost,
  }
}
