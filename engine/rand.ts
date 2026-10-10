/**
 * @file engine/rand.ts
 * @description Deterministic seeded RNG for the star-field engine — the
 * procedural galaxies, black-hole plasma and hierarchy speckles all draw
 * from these so every boot renders the identical star field (no flicker
 * between visits, no `Math.random` non-determinism in tests).
 */

/**
 * Deterministic linear congruential generator — same seed → same
 * sequence every session (Numerical-Recipes constants).
 * @param seed Arbitrary seed derived from a body id hash.
 * @returns () => float in [0,1).
 */
export function lcg(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 4294967296
  }
}

/**
 * Seeds the LCG from a string — FNV-1a hash so every body id scatters
 * differently but reproducibly.
 * @param id Body id string.
 */
export function seedFrom(id: string): number {
  let h = 2166136261

  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  }

  return h
}
