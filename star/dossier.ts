/**
 * @file star/dossier.ts
 * @description Lazy dossier loader for star-field bodies — fetches
 * `public/data/<locale>/<id>.json` on selection, hover, or camera
 * approach, falling back to `public/data/en/<id>.json` when the active
 * locale has no translated file yet. Dossiers are cached per
 * `locale:id` so a later select never hits the network twice, and a
 * locale switch refetches only the selected body's file in the new
 * language.
 */
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'
import { LOCALES } from '@core/tokens/locales.js'
import type { SFDossier } from '../engine/types.js'
import type { StarField } from '../StarField.js'
import store from '@core/store.js'
import { devError, devWarn } from '@core/devlog.js'

/** In-flight + resolved dossier cache — `locale:id` → dossier (or promise). */
const _cache = new Map<string, Promise<SFDossier | null>>()

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
 * Fetches one locale dossier JSON — `data/<locale>/<id>.json`, with the
 * canonical English file as fallback so a not-yet-translated body still
 * shows real data instead of an empty panel.
 * @param id Body id matching `public/data/<locale>/<id>.json`.
 * @param locale Active locale code — defaults to the store's current.
 * @returns The parsed dossier or null on fetch/parse failure.
 */
export function fetchDossier(id: string, locale?: string | null): Promise<SFDossier | null> {
  const code = dossierLocale(locale ?? store.getters.getLang())

  const key = `${code}:${id}`

  let pending = _cache.get(key)

  if (!pending) {
    pending = fetchJson(`${SF_DATA_BASE}/${code}/${id}.json`, id).then(
      (d) =>
        d ??
        (code === LOCALES.EN ? null : fetchJson(`${SF_DATA_BASE}/${LOCALES.EN}/${id}.json`, id))
    )

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

  fetchDossier(id).then((file) => {
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
