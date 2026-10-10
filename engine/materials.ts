/**
 * @file engine/materials.ts
 * @description Material-parameter hygiene for the body builders. Three.js
 * logs `parameter 'x' has value of undefined` for every prop explicitly
 * passed as undefined (a missing texture, a colorless def, a glow map
 * that failed to rasterize on 2d-less environments). `matParams` drops
 * those keys before the material ctor so the console stays clean and
 * three falls back to its own defaults.
 */

/**
 * Returns a copy of `opts` without keys whose value is `undefined` —
 * safe to spread into any `*Material` parameter object.
 * @param opts Material parameter object possibly containing undefineds.
 * @returns The same shape minus undefined values.
 */
export function matParams<T extends Record<string, unknown>>(opts: T): T {
  const out: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) out[k] = v
  }

  return out as T
}
