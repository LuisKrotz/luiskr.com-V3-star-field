/**
 * @file engine/catalog.ts
 * @description The star-field body catalog — one static SFBodyDef per
 * navigable object. Values are scene-chart units, NOT real distances:
 * the Solar System sits compressed at the origin, nearby Milky Way
 * systems spread across the mid-field galactic plane, nebulae further
 * out, and external galaxies on the far ring so a single orbit-camera
 * sweep reads as a voyage from home to deep space.
 *
 * `orbit`/`parent` bodies revolve procedurally; `pos` bodies are fixed
 * markers on the chart. `satellites` are decorative non-pickable
 * companions (exoplanets, binary partners). Dossier text lives in
 * `public/data/<id>.json` and lazy-loads on approach/selection.
 *
 * The def tables live under `catalog/` — one module per group:
 *   `geo.ts`         — chart-geometry helpers (`gpos`, MW_CENTER/
 *                      MW_RADIUS, M31_POS, `shrinkSolar`).
 *   `solar.ts`       — the solar-system tier (Sun → Kuiper belt).
 *   `milky-way.ts`   — famous nearby systems at honest compressed radii.
 *   `nebulae.ts`     — nebulae + globular clusters.
 *   `galaxies.ts`    — the grand spirals (MW disc, M31, M33).
 *   `local-group.ts` — dwarf + satellite galaxy smudges.
 *   `hierarchy.ts`   — cosmic-boundary landmark structures.
 */

import { SF_GROUPS } from '@core/tokens/starfield/kinds.js'
import type { SFBodyDef } from './types.js'

import { GALAXIES } from './catalog/galaxies.js'
import { HIERARCHY } from './catalog/hierarchy.js'
import { LOCAL_GROUP } from './catalog/local-group.js'
import { MILKY_WAY } from './catalog/milky-way.js'
import { NEBULAE } from './catalog/nebulae.js'
import { SOLAR } from './catalog/solar.js'

export { shrinkSolar } from './catalog/geo.js'

/** Full catalog — the order the navigator drawer lists groups in. */
export const SF_CATALOG: readonly SFBodyDef[] = Object.freeze([
  ...SOLAR,
  ...MILKY_WAY,
  ...NEBULAE,
  ...GALAXIES,
  ...LOCAL_GROUP,
  ...HIERARCHY,
])

/** Ordered group keys for the navigator drawer sections. */
export const SF_GROUP_ORDER: readonly string[] = Object.freeze([
  SF_GROUPS.SOLAR,
  SF_GROUPS.MILKY_WAY,
  SF_GROUPS.NEBULAE,
  SF_GROUPS.GALAXIES,
  SF_GROUPS.LOCAL_GROUP,
  SF_GROUPS.HIERARCHY,
])

/**
 * Groups catalog entries by SF_GROUPS key — the navigator renders one
 * section per key with the body's display name on a focusable button.
 * @returns group key → defs in catalog order
 */
export function sfCatalogByGroup(): Map<string, SFBodyDef[]> {
  const map = new Map<string, SFBodyDef[]>()

  for (const def of SF_CATALOG) {
    const list = map.get(def.group) ?? []

    list.push(def)

    map.set(def.group, list)
  }

  return map
}
