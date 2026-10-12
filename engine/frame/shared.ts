/**
 * @file engine/frame/shared.ts
 * @description Lazily-armed frame state — bootstrap injects the real
 * three.js Vector3/Color constructors after the lazy import so the
 * per-frame modules never import three directly. A mutable `armed`
 * record (not bare exported lets) so sibling modules can both read and
 * lazily initialize the shared scratch vector; live-binding `let`
 * exports are not assignable from importing modules.
 */
import { SF_COLORS } from '@core/tokens/starfield/params.js'

/** Vector3-like constructor armed by bootstrap. */
export type Vec3Ctor = new () => {
  x: number
  y: number
  z: number
  project?(camera: unknown): unknown
}

/** Color-like constructor armed by bootstrap (glaciation ramp). */
export type ColorCtor = new (hex?: number | string) => {
  lerpColors(a: never, b: never, k: number): unknown
}

/**
 * Mutable per-module state shared across the frame/ submodules:
 *   vec3    — armed Vector3 ctor (null until `armFrame` runs).
 *   scratch — reused world-position vector (zero per-frame alloc).
 *   ice/warm — pre-built glaciation tint ramp for `cycle` bodies.
 */
export const armed: {
  vec3: Vec3Ctor | null
  scratch: { x: number; y: number; z: number } | null
  ice: unknown
  warm: unknown
} = { vec3: null, scratch: null, ice: null, warm: null }

/**
 * Stores the real Vector3 (+ optional Color) constructors — bootstrap
 * calls this after the lazy three import so the frame modules never
 * import three itself. The Color pair pre-builds the glaciation tint
 * ramp so the per-frame cycle lerps without allocating.
 * @param V The three.js Vector3 class.
 * @param C The three.js Color class (optional — tests may omit it).
 */
export function armFrame(V: Vec3Ctor, C?: ColorCtor): void {
  armed.vec3 = V
  armed.scratch = null
  armed.ice = C ? new C(SF_COLORS.EARTH_ICE) : null
  armed.warm = C ? new C(SF_COLORS.SUN_LIGHT) : null
}
