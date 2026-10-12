/**
 * @file engine/spiral.ts
 * @description Barrel for the spiral-galaxy surface — the deterministic
 * point-cloud fills (spiral/elliptical/dust, mirrored byte-for-byte in
 * the WASM worker) live in `spiral/fill.ts`, and the scene assembly
 * (`makeSpiralGalaxy` — photo disc, sparkle layer, worker-dispatched
 * fill with identical local fallback, dust lanes, core sprite, pick
 * sphere) lives in `spiral/galaxy.ts`.
 *
 * The distribution is deterministic (seeded LCG) so every boot draws the
 * same galaxy — no flicker between visits, no per-frame allocation.
 */
export { makeSpiralGalaxy } from './spiral/galaxy.js'
export { fillSpiral, fillElliptical, fillDust } from './spiral/fill.js'
