/**
 * @file star/print.tsx
 * @description Print composition for the star chart — on `printprepare`
 *   the catalog becomes a book: a contents leaf, then per region group
 *   a `.print-face` section cover plus one `.print-plate--dossier`
 *   sheet per body (name, kind tag, tagline, facts, history, prose
 *   sections, the downloaded image gallery, provenance, and a QR back
 *   to the body's own route). A selected body prints as the same book
 *   excerpt — its group's cover and that one dossier. The deep catalog
 *   (~140k registry records — too many for paper) closes the run with
 *   its own cover and a synthesized index page: per-kind counts, the
 *   three catalogues' prose and provenance. The composition registers
 *   with `trackPrintJob` so the gated entry sees the plates complete —
 *   dossiers fetched, images decoded — before the walk; every injected
 *   node registers with `trackPrintNode` so exit removes it.
 */
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { NAV_TEXT } from '@core/tokens/strings/text.js'
import { PRINT_CLASSES } from '@core/tokens/classes/print.js'
import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { TRANSLATION_KEYS } from '@core/tokens/routes/translation-keys.js'
import { SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { FALLBACK_PAGES } from '@core/locale/fallback.js'
import { h } from '@core/jsx.js'
import { qrSvg } from '@core/utils/print/qr.js'
import { trackPrintJob, trackPrintNode } from '@core/utils/print/print.js'
import { fetchDossier, prefetchDossier, syncDossier } from './dossier.js'
import { mediaUrl, renderFacts, renderSections, renderSignature } from './render.js'
import { SF_CATALOG, SF_GROUP_ORDER, sfCatalogByGroup } from '../engine/catalog.js'
import {
  ensureRegistryManifest,
  syncRegistryManifest,
  type SFRegistryManifest,
} from '../engine/registry.js'
import type { SFDossier, SFDossierMedia } from '../engine/types.js'
import type { StarField } from '../StarField.js'

/**
 * One seated part of the book — a group section (face cover + its
 * dossier run) in `SF_GROUP_ORDER` position.
 */
interface BookPart {
  /** Localized group title for the cover hub and the contents row. */
  title: string
  /** Resolved dossiers in catalog order. */
  dossiers: SFDossier[]
}

/**
 * The two-digit part number stamped on each section cover and contents
 * row — "01" … "07" across the six groups plus the deep catalog.
 * @param index Zero-based part index in seating order.
 * @returns Padded numeral.
 */
const partNum = (index: number): string => String(index + 1).padStart(2, CHAR_STRINGS.ZERO)

/**
 * Merged locale label map — the English snapshot under the loaded
 * translations, so a not-yet-translated key still prints real copy.
 * @param host The live StarField — supplies the loaded translations.
 * @returns The merged label map.
 */
const mergedLabels = (host: StarField): Record<string, unknown> => ({
  ...(FALLBACK_PAGES[TRANSLATION_KEYS.STAR_FIELD] as Record<string, unknown>),
  ...(host.translations ?? {}),
})

/**
 * Builds one section cover — a `.print-face` sibling on the same
 * margin-zero named page: the loader's glow, blueprint grid and twin
 * orbital rings behind the padded part number, the localized group
 * title, and the seated-record count. `hidden` keeps it off screen;
 * the print sheet's `.print-face` rules paint it on paper.
 * @param num Padded part numeral ("01"…).
 * @param title Localized group title for the hub.
 * @param count "N records" furniture line — empty suppresses the span.
 * @returns The seated cover element.
 */
const sectionCover = (num: string, title: string, count: string): HTMLElement =>
  (
    <div className={`${PRINT_CLASSES.FACE} ${PRINT_CLASSES.SECTION}`} hidden>
      <span className={PRINT_CLASSES.FACE_GLOW} />
      <span className={PRINT_CLASSES.FACE_GRID} />
      <span className={PRINT_CLASSES.FACE_SPINNER} />
      <span className={PRINT_CLASSES.FACE_SPINNER_INNER} />
      <span className={PRINT_CLASSES.SECTION_NUM}>{num}</span>
      <span className={PRINT_CLASSES.SECTION_TITLE}>{title}</span>
      {count ? <span className={PRINT_CLASSES.SECTION_COUNT}>{count}</span> : null}
    </div>
  ) as HTMLElement

/**
 * Builds the book's contents leaf — the shared `.print-toc` skin
 * (numbered part rows with each body's localized name indented under
 * its section, mirroring the front-of-book leaf the home route gets
 * from the live headings this route lacks). The deep catalog's row
 * lists no names — its records index on the part's own plate.
 * @param host The live StarField — supplies the localized names table.
 * @param parts Resolved group sections in seating order.
 * @param t Merged locale label map.
 * @returns The `.print-toc` element.
 */
const tocLeaf = (host: StarField, parts: BookPart[], t: Record<string, unknown>): HTMLElement => {
  const entries = parts.map((part, i) => ({
    num: partNum(i),
    title: part.title,
    names: part.dossiers.map((d) => host._names?.byId.get(d.id) ?? d.name),
  }))

  entries.push({
    num: partNum(parts.length),
    title: String(t.catalog ?? ATTR_VALUES.EMPTY),
    names: [],
  })

  return (
    <div className={PRINT_CLASSES.TOC} hidden>
      <h2 className={PRINT_CLASSES.TOC_HEAD}>{NAV_TEXT.CONTENTS}</h2>
      {entries.map((entry) => [
        <div className={PRINT_CLASSES.TOC_ITEM}>
          <span className={PRINT_CLASSES.TOC_NUM}>{entry.num}</span>
          <span className={PRINT_CLASSES.TOC_TEXT}>{entry.title}</span>
        </div>,
        entry.names.map((name) => (
          <div className={PRINT_CLASSES.TOC_ITEM_SUB}>
            <span className={PRINT_CLASSES.TOC_NUM} />
            <span className={PRINT_CLASSES.TOC_TEXT}>{name}</span>
          </div>
        )),
      ])}
    </div>
  ) as HTMLElement
}

/**
 * Builds one dossier plate — a full-sheet editorial card on the
 * margin-zero named page: headline + kind tag, the tagline as
 * standfirst, the facts list and prose, the image gallery (videos
 * contribute their posters — an MP4 can't paint on paper), the
 * provenance line, and an anchored QR to the body's live route.
 * @param host The live StarField — supplies the route path, the slug
 *   map, and the locale label node.
 * @param dossier The resolved body dossier.
 * @param t Merged locale label map (defaults + loaded translations).
 * @param decodes Sink collecting gallery-image decode promises — the
 *   caller awaits the bag so the walk never meets a mid-flight fetch.
 * @returns The seated plate element (hidden until print media applies).
 */
const dossierPlate = (
  host: StarField,
  dossier: SFDossier,
  t: Record<string, unknown>,
  decodes: Promise<unknown>[]
): HTMLElement => {
  const kindLabel = String(t[dossier.kind] ?? dossier.kind)

  const bodyUrl = `${window.location.origin}${host._baseStarPath()}${CHAR_STRINGS.SLASH}${host._slugForId(dossier.id)}`

  const qr = qrSvg(bodyUrl)

  const images: SFDossierMedia[] = [
    ...(dossier.media?.images ?? []),
    // A video's poster IS its printable surface — the gallery keeps the
    // frame the dossier's credit line describes.
    ...(dossier.media?.videos ?? [])
      .filter((vid) => Boolean(vid.poster))
      .map((vid) => ({ ...vid, src: vid.poster as string })),
  ]

  return (
    <section className={`${PRINT_CLASSES.PLATE} ${PRINT_CLASSES.PLATE_DOSSIER}`} hidden>
      <header>
        <h2>{dossier.name}</h2>
        {kindLabel ? <span className={SF_CLASSES.SF_PANEL_TAG}>{kindLabel}</span> : null}
      </header>

      {dossier.tagline ? <p className={SF_CLASSES.SF_PANEL_TAGLINE}>{dossier.tagline}</p> : null}

      {renderFacts(dossier)}

      {dossier.history ? <p className={SF_CLASSES.SF_PANEL_HISTORY}>{dossier.history}</p> : null}

      {renderSections(dossier)}

      {images.map((img) => (
        <figure key={img.src} className={SF_CLASSES.SF_MEDIA_FIG}>
          <img
            className={SF_CLASSES.SF_MEDIA_IMG}
            src={mediaUrl(img.src)}
            alt={img.caption ?? ATTR_VALUES.EMPTY}
            ref={(el) => {
              // The ref only ever fires on this <img> — duck-type the
              // decode (realm instanceof checks on HTMLImageElement are
              // unreliable: happy-dom doesn't attach it globally).
              decodes.push((el as HTMLImageElement).decode?.().catch(() => undefined))
            }}
          />
          {img.caption || img.credit ? (
            <figcaption className={SF_CLASSES.SF_MEDIA_CAP}>
              {img.caption}
              {img.credit ? ` — ${img.credit}` : ATTR_VALUES.EMPTY}
            </figcaption>
          ) : null}
        </figure>
      ))}

      <footer>
        {dossier.source ? (
          <p className={SF_CLASSES.SF_PANEL_SOURCE}>
            {String(t.source ?? ATTR_VALUES.EMPTY)}: {dossier.source}
          </p>
        ) : null}
        {renderSignature(dossier, t)}
      </footer>

      {qr ? (
        <a className={PRINT_CLASSES.QR_LINK} href={bodyUrl}>
          {qr}
        </a>
      ) : null}
    </section>
  ) as HTMLElement
}

/**
 * Builds the deep catalog's index plate — the part that can't paginate
 * (~140k records, one shard fetch per thousand) closes on a dossier-
 * shaped index instead: the kind-by-kind record counts as facts, the
 * three catalogues' prose as sections, their provenance as the source
 * footer, and a QR back to the live chart where every record resolves.
 * @param host The live StarField — supplies the route path.
 * @param manifest Resolved registry manifest (null on a cold sync
 *   path) — counts omit when it never landed.
 * @param t Merged locale label map.
 * @returns The seated index plate element.
 */
const catalogIndexPlate = (
  host: StarField,
  manifest: SFRegistryManifest | null,
  t: Record<string, unknown>
): HTMLElement => {
  const chartUrl = `${window.location.origin}${host._baseStarPath()}`

  const qr = qrSvg(chartUrl)

  const sources = [SF_STAR_CLOUD.SRC_HYG, SF_STAR_CLOUD.SRC_EXO, SF_STAR_CLOUD.SRC_DSO].join(
    ` ${CHAR_STRINGS.DOT_SEP} `
  )

  return (
    <section className={`${PRINT_CLASSES.PLATE} ${PRINT_CLASSES.PLATE_DOSSIER}`} hidden>
      <header>
        <h2>{String(t.catalog ?? ATTR_VALUES.EMPTY)}</h2>
      </header>

      {manifest ? (
        <dl className={SF_CLASSES.SF_FACTS}>
          {SF_STAR_CLOUD.REGISTRY_KINDS.map((kind) => (
            <div key={kind} className={SF_CLASSES.SF_FACT}>
              <dt className={SF_CLASSES.SF_FACT_KEY}>{String(t[kind] ?? kind)}</dt>
              <dd className={SF_CLASSES.SF_FACT_VAL}>
                {(manifest.kinds[kind]?.count ?? 0).toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className={SF_CLASSES.SF_PANEL_SECTIONS}>
        {SF_STAR_CLOUD.REGISTRY_KINDS.map((kind) => (
          <section key={kind} className={SF_CLASSES.SF_PANEL_SEC}>
            <h3 className={SF_CLASSES.SF_PANEL_SEC_TITLE}>
              {String(t[`registry_${kind}`] ?? kind)}
            </h3>
            <p className={SF_CLASSES.SF_PANEL_SEC_BODY}>
              {String(t[`registry_${kind}_about`] ?? ATTR_VALUES.EMPTY)}
            </p>
          </section>
        ))}
      </div>

      <footer>
        <p className={SF_CLASSES.SF_PANEL_SOURCE}>
          {String(t.source ?? ATTR_VALUES.EMPTY)}: {sources}
        </p>
        <p className={SF_CLASSES.SF_PANEL_SIG}>
          {String(t.acquired ?? ATTR_VALUES.EMPTY)}: {SF_STAR_CLOUD.REGISTRY_ACQUIRED}
        </p>
      </footer>

      {qr ? (
        <a className={PRINT_CLASSES.QR_LINK} href={chartUrl}>
          {qr}
        </a>
      ) : null}
    </section>
  ) as HTMLElement
}

/**
 * Seats the composed book at `<body>` level in document order — the
 * `print-plate-doc` contract hides only `#app`'s own children, so
 * body-level nodes sit in the flow right where the capture plate ends:
 * the contents leaf first, then per part its cover and dossier run,
 * and the deep-catalog cover + index closing the volume. Every node
 * registers with `trackPrintNode` for the exit sweep.
 * @param host The live StarField.
 * @param parts Resolved group sections in seating order.
 * @param manifest Resolved registry manifest, or null.
 * @param t Merged locale label map.
 * @param decodes Sink collecting gallery-image decode promises.
 * @param isBook The full volume seats the contents leaf and the deep-
 *   catalog part; a selected-body excerpt skips both.
 */
const seatBook = (
  host: StarField,
  parts: BookPart[],
  manifest: SFRegistryManifest | null,
  t: Record<string, unknown>,
  decodes: Promise<unknown>[],
  isBook: boolean
): void => {
  // A second printprepare inside one job (the gated dispatch plus an
  // interleaved beforeprint's announce, or a repeated event on the same
  // committed DOM) must not seat a second volume — the section covers
  // are this book's own marker, and the check holds for concurrent
  // async composes since seating is one synchronous pass.
  if (document.querySelector(`.${PRINT_CLASSES.SECTION}`)) return

  /** Appends one injected node at body level and registers it with the
   *  exit sweep so the job's teardown removes it with the copies. */
  const seat = (el: HTMLElement): void => {
    document.body.appendChild(el)

    trackPrintNode(el)
  }

  /** The cover's "N records" furniture line — the part's seated count
   *  against the locale's `records` word. */
  const countLine = (n: number): string =>
    `${n.toLocaleString()} ${String(t.records ?? ATTR_VALUES.EMPTY)}`

  if (isBook) seat(tocLeaf(host, parts, t))

  parts.forEach((part, i) => {
    seat(sectionCover(partNum(i), part.title, countLine(part.dossiers.length)))

    for (const dossier of part.dossiers) seat(dossierPlate(host, dossier, t, decodes))
  })

  if (!isBook) return

  // The deep catalog's records can't paginate — the part closes on the
  // synthesized index plate instead (kind counts + catalogue sources).
  seat(
    sectionCover(
      partNum(parts.length),
      String(t.catalog ?? ATTR_VALUES.EMPTY),
      manifest ? countLine(manifest.total) : ATTR_VALUES.EMPTY
    )
  )

  seat(catalogIndexPlate(host, manifest, t))
}

/**
 * Wraps one resolved dossier as the book's excerpt part — the selected
 * body's own section (its catalog group's title, or the kind label for
 * a registry record, which owns no group).
 * @param selectedId The body id the excerpt was composed for — read
 *   once by the caller so an async resolve can't race a selection
 *   change into a mismatched group title.
 * @param dossier The selected body's resolved dossier.
 * @param t Merged locale label map.
 * @returns The single-part list.
 */
const excerptPart = (
  selectedId: string,
  dossier: SFDossier,
  t: Record<string, unknown>
): BookPart[] => {
  const def = SF_CATALOG.find((d) => d.id === selectedId)

  return [
    {
      title: String(t[def?.group ?? dossier.kind] ?? dossier.kind),
      dossiers: [dossier],
    },
  ]
}

/**
 * Builds the book part list for the async arm — the full volume walks
 * `SF_GROUP_ORDER` collecting each group's resolved dossiers (empty
 * groups drop so a wholesale fetch failure can't strand an empty
 * section); a selection short-circuits to the excerpt part.
 * @param host The live StarField.
 * @param t Merged locale label map.
 * @param selectedId The caller's selection snapshot (null for the full
 *   volume) — async resolution can't observe a mid-compose re-select.
 * @returns The parts in seating order.
 */
const bookParts = async (
  host: StarField,
  t: Record<string, unknown>,
  selectedId: string | null
): Promise<BookPart[]> => {
  if (selectedId) {
    const dossier = await fetchDossier(selectedId, null, host.translations)

    return dossier ? excerptPart(selectedId, dossier, t) : []
  }

  const groups = sfCatalogByGroup()

  const parts: BookPart[] = []

  for (const key of SF_GROUP_ORDER) {
    const dossiers = (
      await Promise.all(
        (groups.get(key) ?? []).map((def) => fetchDossier(def.id, null, host.translations))
      )
    ).filter((d): d is SFDossier => d !== null)

    if (dossiers.length) parts.push({ title: String(t[key] ?? key), dossiers })
  }

  return parts
}

/**
 * Builds the book part list synchronously — same shape as the async
 * arm but reads only the resolved dossier cache so the beforeprint
 * path can seat what the idle warm already landed. A group seats only
 * when EVERY def resolved — a partially-warmed section printing half
 * its bodies would read as a data bug, so it defers to the async arm
 * wholesale.
 * @param host The live StarField.
 * @param t Merged locale label map.
 * @param selectedId The caller's selection snapshot (null for the full
 *   volume).
 * @returns The parts in seating order, or null when any dossier is
 *   unresolved (the caller then tracks the async compose).
 */
const bookPartsSync = (
  host: StarField,
  t: Record<string, unknown>,
  selectedId: string | null
): BookPart[] | null => {
  if (selectedId) {
    const dossier = syncDossier(host, selectedId)

    return dossier ? excerptPart(selectedId, dossier, t) : null
  }

  const groups = sfCatalogByGroup()

  const parts: BookPart[] = []

  for (const key of SF_GROUP_ORDER) {
    const dossiers = (groups.get(key) ?? []).map((def) => syncDossier(host, def.id))

    if (dossiers.some((d) => d === null)) return null

    if (dossiers.length)
      parts.push({ title: String(t[key] ?? key), dossiers: dossiers as SFDossier[] })
  }

  return parts.length ? parts : null
}

/**
 * The async compose pass — resolves every target dossier (and the
 * registry manifest the deep-catalog furniture reads), seats the book,
 * then awaits every gallery decode so the job's barrier counts them.
 * @param host The live StarField.
 */
const composeBook = async (host: StarField): Promise<void> => {
  // Slugs and display names come from the names table — waiting for it
  // keeps the printed QR targets and contents entries localized
  // instead of falling back to raw ids.
  await host._namesReady

  const t = mergedLabels(host)

  // Read the selection once — the parts list and the seating mode both
  // consume this snapshot, so a mid-compose re-select can't mismatch
  // them.
  const selectedId = host._selectedId

  const parts = await bookParts(host, t, selectedId)

  const manifest = await ensureRegistryManifest()

  const decodes: Promise<unknown>[] = []

  seatBook(host, parts, manifest, t, decodes, !selectedId)

  await Promise.allSettled(decodes)
}

/**
 * Binds the chart's print composition — a `printprepare` listener that
 * prints the whole catalog as a book (contents leaf, one section cover
 * per region group, a dossier sheet per body, the deep-catalog part's
 * cover + index), or the selected body as a one-sheet excerpt under
 * its group's cover. Returns the unbinder for the view's teardown.
 * @param host The live StarField component.
 * @returns Cleanup that removes the listener.
 */
export function bindPrintDossiers(host: StarField): () => void {
  const onPrepare = (): void => {
    // Stale listeners outlive route unmounts — only a connected host
    // may compose (its canvas is the document being printed).
    if (!host.isConnected) return

    const t = mergedLabels(host)

    // Read the selection once — the sync parts build and the seating
    // mode consume the same snapshot.
    const selectedId = host._selectedId

    // Sync arm — dossiers that already resolved (the idle warm covers
    // the common path) seat now so the synchronous beforeprint path
    // prints the same book. Any miss drops to the tracked async
    // compose the gated entry awaits.
    const parts = bookPartsSync(host, t, selectedId)

    if (parts) {
      const decodes: Promise<unknown>[] = []

      seatBook(host, parts, syncRegistryManifest(), t, decodes, !selectedId)

      trackPrintJob(Promise.allSettled(decodes).then(() => undefined))

      return
    }

    trackPrintJob(composeBook(host))
  }

  window.addEventListener(PRINT_EVENTS.PREPARE, onPrepare)

  // Warm every catalog dossier plus the registry manifest at idle —
  // the next print composes the full volume from the resolved cache
  // instead of waiting on fetches (and the synchronous path can print
  // it at all).
  const warm = (): void => {
    for (const def of SF_CATALOG) prefetchDossier(def.id)

    void ensureRegistryManifest()
  }

  const ric = window.requestIdleCallback

  if (typeof ric === TYPE_STRINGS.FUNCTION) {
    void host._namesReady.then(() => ric(warm))
  } else {
    void host._namesReady.then(warm)
  }

  return () => window.removeEventListener(PRINT_EVENTS.PREPARE, onPrepare)
}
