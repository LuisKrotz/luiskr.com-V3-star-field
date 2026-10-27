/**
 * @file star/schema.ts
 * @description Runtime JSON-LD parity for the star-field route — the
 * prerendered graphs (index ItemList of authored bodies + registry
 * DataCatalog, Article/Thing per body dossier) are replaced by the
 * router's base graph on hydration, so this module re-emits the rich
 * entities once the data they describe has resolved: the locale
 * body-name table for index items, the registry manifest for
 * DataCatalog datasets, and the loaded dossier for body pages.
 */
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'
import {
  SF_REGISTRY_INDEX_DIR,
  SF_REGISTRY_MANIFEST,
  SF_REGISTRY_KINDS,
} from '@core/tokens/starfield/registry.js'
import { SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { NET_STRINGS } from '@core/tokens/strings/net.js'
import { BASE_TITLE } from '@core/tokens/routes.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import {
  generateStarIndexSchema,
  generateStarBodySchema,
  updateJsonLd,
} from '@core/utils/schema.js'
import router from '@core/router/router.js'
import store from '@core/store.js'
import { ensureRegistryManifest } from '../engine/registry.js'
import { sfCatalogByGroup } from '../engine/catalog.js'
import type { StarField } from '../StarField.js'
import type { SFDossier } from '../engine/types.js'
import type { SFRegistryManifest } from '../engine/registry.js'

/**
 * Route meta title minus the BASE_TITLE affixes — the same page-name
 * derivation buildRouteJsonLd applies, so emitted WebPage names match
 * the document title.
 * @param route The current star-field route descriptor.
 * @returns The bare page name.
 */
const _pageName = (title: unknown): string => {
  const raw = String(title || BASE_TITLE)

  return raw
    .replace(`${BASE_TITLE} ${CHAR_STRINGS.PIPE_SEP} `, CHAR_STRINGS.EMPTY)
    .replace(` ${CHAR_STRINGS.PIPE_SEP} ${BASE_TITLE}`, CHAR_STRINGS.EMPTY)
}

/** Guards emit calls — never writes a star-field graph after navigating away. */
const _onStarRoute = (): boolean => router.currentRoute?.view === VIEW_TAGS.VIEW_STAR_FIELD

/**
 * DataCatalog datasets from the resolved registry manifest — per-kind
 * Dataset (manifest + every shard JSON as DataDownload) plus the packed
 * deep-field binary, mirroring the build-time entity.
 * @param c       The view (translations supply the localized labels).
 * @param indexUrl Absolute star-field index URL — dataset @id bases.
 * @param manifest The registry manifest (kinds → counts + shard files).
 * @returns Prepared dataset descriptors for generateStarIndexSchema().
 */
const _datasets = (
  c: StarField,
  indexUrl: string,
  manifest: SFRegistryManifest
): Array<{
  kind: string
  name: string
  description?: string
  credit?: string
  distributions: Array<{ url: string; format: string }>
}> => {
  const page = c.translations || {}

  const manifestDist = {
    url: `${NET_STRINGS.SITE_URL}${SF_DATA_BASE}/${SF_REGISTRY_INDEX_DIR}/${SF_REGISTRY_MANIFEST}`,
    format: NET_STRINGS.MIME_JSON,
  }

  const kinds = SF_REGISTRY_KINDS.map(({ kind, labelKey, aboutKey, credit }) => {
    const meta = manifest.kinds?.[kind]

    return {
      kind,
      name: (page[labelKey] as string) || kind,
      description: (page[aboutKey] as string) || undefined,
      credit,
      distributions: [
        manifestDist,
        ...(meta?.shards || []).map((shard) => ({
          url: `${NET_STRINGS.SITE_URL}${SF_DATA_BASE}/${SF_REGISTRY_INDEX_DIR}/${shard}`,
          format: NET_STRINGS.MIME_JSON,
        })),
      ],
    }
  })

  return [
    ...kinds,
    {
      kind: 'deep-field',
      name: 'Deep field — packed binary',
      description:
        'Every registry record packed little-endian Float32 (x, y, z heliocentric light-years, apparent magnitude, B-V colour index, kind: 0 star / 1 exoplanet / 2 deep-sky object) behind a uint32 record-count header — the renderer-side form of the same catalog.',
      distributions: [
        {
          url: `${NET_STRINGS.SITE_URL}${SF_DATA_BASE}/${SF_STAR_CLOUD.FILE}`,
          format: NET_STRINGS.MIME_OCTET_STREAM,
        },
      ],
    },
  ]
}

/**
 * Emits the index graph — route base + authored-body ItemList +
 * registry DataCatalog. The item names prefer the loaded locale table
 * and fall back to the authored catalog names; the manifest fetch is
 * the registry's own lazy promise so the graph arrives whenever the
 * catalog data does, at zero extra network cost once cached.
 * @param c The view.
 */
export function emitStarIndexJsonLd(c: StarField): void {
  const route = router.currentRoute

  if (!route || route.view !== VIEW_TAGS.VIEW_STAR_FIELD || route.params?.body) return

  const indexUrl = `${NET_STRINGS.SITE_URL}${c._baseStarPath()}`

  const page = c.translations || {}

  const items = [...sfCatalogByGroup().values()].flat().map((def) => ({
    url: `${indexUrl}/${def.id}`,
    name: c._names?.byId.get(def.id) ?? def.name,
  }))

  void ensureRegistryManifest().then((manifest) => {
    if (!_onStarRoute() || router.currentRoute?.params?.body) return

    updateJsonLd(
      generateStarIndexSchema({
        url: indexUrl,
        name: _pageName(route.meta?.title),
        lang: store.getters.getLang(),
        items,
        catalogName: (page.catalog as string) || undefined,
        datasets: manifest ? _datasets(c, indexUrl, manifest) : undefined,
      })
    )
  })
}

/**
 * Emits the body dossier graph — route base + Article/Thing — once the
 * dossier JSON has resolved for the selected body. The canonical URL
 * always carries the raw catalog id (the emitted static page), never
 * the localized slug the address bar may show.
 * @param c       The view.
 * @param id      The selected catalog/registry id.
 * @param dossier The resolved dossier payload (may be null on failure).
 */
export function emitStarBodyJsonLd(c: StarField, id: string, dossier: SFDossier | null): void {
  const route = router.currentRoute

  if (!route || route.view !== VIEW_TAGS.VIEW_STAR_FIELD || c._selectedId !== id) return

  const indexUrl = `${NET_STRINGS.SITE_URL}${c._baseStarPath()}`

  const page = c.translations || {}

  const name = dossier?.name || c._names?.byId.get(id) || id

  updateJsonLd(
    generateStarBodySchema({
      url: `${indexUrl}/${id}`,
      indexUrl,
      indexName: (page.title as string) || _pageName(route.meta?.title),
      name,
      tagline: dossier?.tagline,
      facts: dossier?.facts,
      lang: store.getters.getLang(),
    })
  )
}
