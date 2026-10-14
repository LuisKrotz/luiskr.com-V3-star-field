/**
 * @file star/dossier.ts
 * @description Lazy dossier loader for star-field bodies — fetches
 * `public/data/<locale>/<id>.json` on selection, hover, or camera
 * approach, falling back to `public/data/en/<id>.json` when the active
 * locale has no translated file yet. Dossiers are cached per
 * `locale:id` so a later select never hits the network twice, and a
 * locale switch refetches only the selected body's file in the new
 * language. Registry ids (`star-NNNNNN`…) bypass JSON entirely — the
 * panel is synthesized from the catalogue record with the locale's
 * field labels, so all 139k+ objects get a real data panel without
 * shipping per-object files.
 */
import { SF_DATA_BASE, SF_NAMES_FILE } from '@core/tokens/starfield/textures.js'
import { LOCALES } from '@core/tokens/locales.js'
import { TRANSLATION_KEYS } from '@core/tokens/routes/translation-keys.js'
import { FALLBACK_PAGES } from '@core/locale/fallback.js'
import { SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { slugify } from '@core/utils/string.js'
import { isRegistryId, loadRegistryRecord } from '../engine/registry.js'
import type { SFRegistryRecord } from '../engine/registry.js'
import type { SFDossier } from '../engine/types.js'
import type { StarField } from '../StarField.js'
import store from '@core/store.js'
import { devError, devWarn } from '@core/devlog.js'

/** In-flight + resolved dossier cache — `locale:id` → dossier (or promise). */
const _cache = new Map<string, Promise<SFDossier | null>>()

/**
 * Locale body-name table — `byId` feeds the navigator rows, hover
 * tooltips and the URL segment; `bySlug` (each name run through the
 * shared `slugify` — NFD-fold, lowercase, `-` runs) resolves translated
 * deep-link segments back to the canonical catalog id.
 */
export interface SFBodyNames {
  /** Canonical body id → localized display name. */
  byId: Map<string, string>
  /** `slugify(localized name)` → canonical body id. */
  bySlug: Map<string, string>
}

/** In-flight + resolved names cache — locale → parsed name table. */
const _namesCache = new Map<string, Promise<SFBodyNames | null>>()

/**
 * Legacy locale aliases — pt/hrx/tli URLs map onto the modern codes
 * whose dossier folders hold the translations.
 * @param locale Active locale code (may be null/undefined).
 * @returns The dossier folder code to fetch.
 */
function dossierLocale(locale: string | null | undefined): string {
  const alias: Record<string, string> = {
    [LOCALES.PT]: LOCALES.BR,
    [LOCALES.HRX]: LOCALES.HRK,
    [LOCALES.TLI]: LOCALES.TLN,
  }

  return locale ? (alias[locale] ?? locale) : LOCALES.EN
}

/**
 * One dossier GET — resolves null on HTTP/parse failure (the panel
 * falls back to the catalog name) rather than throwing.
 * @param url Dossier URL under `SF_DATA_BASE`.
 * @param id Body id for diagnostics.
 * @returns The parsed dossier or null.
 */
function fetchJson(url: string, id: string): Promise<SFDossier | null> {
  return fetch(url)
    .then((res) => {
      if (!res.ok) {
        devWarn('[StarField] dossier fetch failed:', id, res.status)

        return null
      }

      return res.json() as Promise<SFDossier>
    })
    .catch((e) => {
      devError('[StarField] dossier error:', id, e)

      return null
    })
}

/**
 * Builds the names table from a parsed `names.json` payload — forward
 * map verbatim, reverse map keyed by each name's `slugify` output so a
 * localized route segment (`…/via-lactea`) resolves to its catalog id.
 * Slug collisions keep the first id — dossier names are unique within a
 * locale by contract, but a degenerate duplicate must not clobber the
 * catalog body that legitimately owns the segment.
 * @param raw Parsed `{ id: name }` object.
 * @returns The paired lookup maps.
 */
function buildNames(raw: Record<string, string>): SFBodyNames {
  const byId = new Map<string, string>(Object.entries(raw))

  const bySlug = new Map<string, string>()

  for (const [id, name] of byId) {
    const slug = slugify(name)

    if (slug && !bySlug.has(slug)) bySlug.set(slug, id)
  }

  return { byId, bySlug }
}

/**
 * One names-file GET — resolves null on HTTP/parse failure (the UI
 * falls back to catalog names + raw ids) rather than throwing.
 * @param url Names-file URL under `SF_DATA_BASE`.
 * @param code Locale folder for diagnostics.
 * @returns The parsed `{ id: name }` map or null.
 */
function fetchNamesJson(url: string, code: string): Promise<Record<string, string> | null> {
  return Promise.resolve()
    .then(() => fetch(url))
    .then((res) => {
      if (!res.ok) {
        devWarn('[StarField] names fetch failed:', code, res.status)

        return null
      }

      return res.json() as Promise<Record<string, string>>
    })
    .catch((e) => {
      devError('[StarField] names error:', code, e)

      return null
    })
}

/**
 * Fetches the locale's body-name table — `data/<locale>/names.json`,
 * with the canonical English file as fallback. One ~6 KB document per
 * locale, cached per locale code: the navigator renders localized rows
 * and the router reads/writes translated body segments without pulling
 * all 143 dossier files.
 * @param locale Active locale code — defaults to the store's current.
 * @returns The names table, or null when both fetches fail.
 */
export function fetchBodyNames(locale?: string | null): Promise<SFBodyNames | null> {
  const code = dossierLocale(locale ?? store.getters.getLang())

  let pending = _namesCache.get(code)

  if (!pending) {
    pending = fetchNamesJson(`${SF_DATA_BASE}/${code}/${SF_NAMES_FILE}`, code)
      .then(
        (d) =>
          d ??
          (code === LOCALES.EN
            ? null
            : fetchNamesJson(`${SF_DATA_BASE}/${LOCALES.EN}/${SF_NAMES_FILE}`, LOCALES.EN))
      )
      .then((d) => (d ? buildNames(d) : null))

    _namesCache.set(code, pending)
  }

  return pending
}

/**
 * Distance label for a registry record — light-years under a million,
 * "Mly" above, so far-field NGC galaxies read "52 Mly" instead of
 * "52 000 000 ly". Units are universal abbreviations (no translation).
 * @param ly Heliocentric distance in light-years.
 * @returns Formatted distance string.
 */
export function registryDist(ly: number | undefined): string {
  if (ly == null) return '—'

  return ly >= SF_STAR_CLOUD.MLY
    ? `${(ly / SF_STAR_CLOUD.MLY).toFixed(1)} Mly`
    : `${Math.round(ly).toLocaleString()} ly`
}

/**
 * Synthesizes a dossier-shaped view for one registry record — the
 * 139k-object catalog can't ship per-object prose files, so the panel
 * shows the real catalogue fields (designation, magnitude, distance,
 * spectral/type, coordinates, provenance) under the locale's label
 * set. `history` carries the dataset description; `meta` signs the
 * acquisition date so the provenance contract matches authored files.
 * @param rec The decoded shard record.
 * @param kind Registry kind (`star`/`exoplanet`/`dso`).
 * @param t Locale label map (pages/star-field node + English defaults).
 * @returns A renderable SFDossier.
 */
function synthRegistryDossier(
  rec: SFRegistryRecord,
  kind: string,
  t: Record<string, unknown>
): SFDossier {
  const L = (k: string): string => String(t[k] ?? k)

  const facts: Array<{ label: string; value: string }> = []

  if (rec.m != null) facts.push({ label: L('magnitude'), value: String(rec.m) })

  if (rec.d != null) facts.push({ label: L('distance'), value: registryDist(rec.d) })

  if (rec.s) facts.push({ label: L('spectralType'), value: rec.s })

  if (rec.c)
    facts.push({ label: kind === 'dso' ? L('designation') : L('constellation'), value: rec.c })

  if (rec.h) facts.push({ label: L('hostStar'), value: rec.h })

  if (rec.t) facts.push({ label: L('dsoType'), value: rec.t })

  if (rec.y2) facts.push({ label: L('discovery'), value: rec.y2 })

  if (rec.r != null) facts.push({ label: L('redshift'), value: String(rec.r) })

  facts.push({
    label: L('coordinates'),
    value: `${rec.x.toFixed(1)}, ${rec.y.toFixed(1)}, ${rec.z.toFixed(1)} ly`,
  })

  const source =
    kind === 'exoplanet'
      ? SF_STAR_CLOUD.SRC_EXO
      : kind === 'dso'
        ? SF_STAR_CLOUD.SRC_DSO
        : SF_STAR_CLOUD.SRC_HYG

  const historyKey = `registry_${kind}`

  return {
    id: rec.i,
    name: rec.n,
    kind: kind === 'dso' ? 'dso' : kind === 'exoplanet' ? 'exoplanet' : 'star',
    tagline: String(t[historyKey] ?? ''),
    facts,
    history: String(t[`${historyKey}_about`] ?? ''),
    source,
    meta: {
      acquired: SF_STAR_CLOUD.REGISTRY_ACQUIRED,
      translated: SF_STAR_CLOUD.REGISTRY_ACQUIRED,
      locale: LOCALES.EN,
    },
  }
}

/**
 * Fetches one locale dossier JSON — `data/<locale>/<id>.json`, with the
 * canonical English file as fallback so a not-yet-translated body still
 * shows real data instead of an empty panel. Registry ids skip the JSON
 * path entirely: their record comes from the sharded catalogue index
 * and the panel is synthesized with the locale's field labels.
 * @param id Body id matching `public/data/<locale>/<id>.json`, or a
 *   registry id (`star-NNNNNN`, `exoplanet-NNNNNN`, `dso-NNNNNN`).
 * @param locale Active locale code — defaults to the store's current.
 * @param labels Optional label map for registry synthesis (component's
 *   merged translations); the English snapshot fills any gaps.
 * @returns The parsed dossier or null on fetch/parse failure.
 */
export function fetchDossier(
  id: string,
  locale?: string | null,
  labels?: Record<string, unknown> | null
): Promise<SFDossier | null> {
  const code = dossierLocale(locale ?? store.getters.getLang())

  const key = `${code}:${id}`

  let pending = _cache.get(key)

  if (!pending) {
    if (isRegistryId(id)) {
      const parsed = id.split('-')[0]

      const t: Record<string, unknown> = {
        ...(FALLBACK_PAGES[TRANSLATION_KEYS.STAR_FIELD] as Record<string, unknown>),
        ...(labels ?? {}),
      }

      pending = loadRegistryRecord(id).then((rec) =>
        rec ? synthRegistryDossier(rec, parsed, t) : null
      )
    } else {
      pending = fetchJson(`${SF_DATA_BASE}/${code}/${id}.json`, id).then(
        (d) =>
          d ??
          (code === LOCALES.EN ? null : fetchJson(`${SF_DATA_BASE}/${LOCALES.EN}/${id}.json`, id))
      )
    }

    _cache.set(key, pending)
  }

  return pending
}

/**
 * Re-derives the panel dossier for the current locale — called on store
 * locale changes so the open panel swaps language; cached files resolve
 * instantly, new locales fetch just the one body's file.
 * @param c The StarField component.
 */
export function applyDossierLocale(c: StarField): void {
  if (!c._selectedId) return

  loadDossier(c, c._selectedId)
}

/**
 * Selection path — marks the panel loading, prefetches, then assigns the
 * resolved dossier only when the selection is still current (a fast
 * second select must not have a slow first response overwrite it).
 * @param c The StarField component.
 * @param id Selected body id.
 */
export function loadDossier(c: StarField, id: string): void {
  c._selectedId = id
  c._dossierLoading = true
  c._dossier = null

  c._updateDom()

  fetchDossier(id, null, c.translations).then((file) => {
    if (c._selectedId !== id) return

    c._dossierLoading = false
    c._dossier = file

    c._updateDom()
  })
}

/**
 * Approach path — warms the cache without touching the panel; the select
 * path later resolves instantly from `_cache`.
 * @param id Approached body id.
 */
export function prefetchDossier(id: string): void {
  fetchDossier(id)
}
