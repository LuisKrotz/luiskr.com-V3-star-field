/**
 * @file engine/bodies/procedural.ts
 * @description Barrel for the seeded canvas texture generators — each
 * recipe now lives in its own module under `procedural/`:
 *
 *   `surface.ts`      — 2:1 equirect surface map: seeded mottling,
 *                       latitude bands on gas giants, crater fields on
 *                       rocky moons/dwarf planets.
 *   `corona.ts`       — star corona sprite: layered luminance (halo,
 *                       hot photosphere knot, limb flare knots,
 *                       blob-chain prominences, H-alpha plumes).
 *   `halo.ts`         — additive star-glow annulus: transparent over
 *                       the photosphere, eased limb-hugging tail.
 *   `star-surface.ts` — equirect photosphere map: convection-cell
 *                       granulation + sunspot groups on active stars.
 *   `gas.ts`          — wispy nebula gas: seeded lobe union with dark
 *                       absorption wisps.
 *   `cluster.ts`      — globular-cluster star speckle: King-profile
 *                       point swarm over an unresolved core glow.
 *   `spikes.ts`       — diffraction-spike starburst: hexagonal cross of
 *                       soft elliptical rays + a faint second cross.
 *   `shared.ts`       — the common paint vocabulary (hex→rgba, blob,
 *                       canvas factory) the recipes share.
 *
 * Everything is deterministic (seeded from the body id via `lcg`), so a
 * body looks identical on every visit, and every generator degrades to
 * `undefined` when no 2d context exists (headless probes) so callers
 * keep their previous glow fallback.
 */
export { surfaceFor } from './procedural/surface.js'
export { coronaFor } from './procedural/corona.js'
export { haloFor, pointGlowFor } from './procedural/halo.js'
export { starSurfaceFor } from './procedural/star-surface.js'
export { gasFor } from './procedural/gas.js'
export { clusterFor } from './procedural/cluster.js'
export { spikesFor } from './procedural/spikes.js'
