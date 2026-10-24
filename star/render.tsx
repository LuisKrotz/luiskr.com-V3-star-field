/**
 * @file star/render.tsx
 * @description JSX for StarField's render() — boot loader overlay (same
 * progress contract as the earth playground), the CSS starfield fallback
 * surface, the body navigator drawer (the keyboard/AT access path: one
 * real button per body), the lazy dossier info panel, the hover/selection
 * aria-live HUD, and the screenshot/overview action buttons.
 */
import { A11Y_CLASSES } from '@core/tokens/classes/a11y.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { FORM_ATTRS } from '@core/tokens/attrs/form.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { CMS_KEYS } from '@core/tokens/data/cms-keys.js'
import { LOADER_UI_KEYS, NAV_UI_KEYS } from '@core/tokens/data/ui-keys.js'
import { APP_IDS } from '@core/tokens/ids/app.js'
import { TRANSLATION_KEYS } from '@core/tokens/routes/translation-keys.js'
import { FALLBACK_PAGES } from '@core/locale/fallback.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { h, Fragment } from '@core/jsx.js'
import { isPlainClick } from '@core/utils/dom.js'
import { appText } from '@core/locale/ui-text.js'
import { SF_ASSET_BASE } from '@core/tokens/starfield/textures.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { KEYS } from '@core/tokens/primitives.js'
import { SF_GROUP_ORDER, sfCatalogByGroup } from '../engine/catalog.js'
import { SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { SF_BADGE } from '@core/tokens/starfield/badge.js'
import { SF_MUSIC_TRACKS } from '@core/tokens/starfield/music.js'
import { DOM_STRINGS } from '@core/tokens/strings/dom.js'
import { MEDIA_ATTRS } from '@core/tokens/attrs/media.js'
import { registryDist } from './dossier.js'
import type { SFRegistryRecord } from '../engine/registry.js'
import type { SFDossier } from '../engine/types.js'
import type { StarField } from '../StarField.js'

/** English snapshot for the pages/star-field node — pre-fetch labels. */
const SF_DEFAULTS = FALLBACK_PAGES[TRANSLATION_KEYS.STAR_FIELD] as Record<string, unknown>

/** Stable aria-controls id for the navigator drawer. */
const NAV_PANEL_ID = APP_IDS.SF_NAV_PANEL

/** Per-body describedby id — `<prefix><body-id>`, unique per row. */
const itemDescId = (id: string): string => `${APP_IDS.SF_ITEM_DESC_PREFIX}${id}`

/**
 * Keyboard-map rows for the instructions sheet — [keycap, localized
 * action label] pairs mirroring `_HOTKEY_ACTIONS` + the arrow/Escape
 * bindings in StarField._bindKeys, so the documented map can never
 * drift from the live handler by more than the pairing in this table.
 * @param t Locale label map.
 * @returns Keycap/description row pairs.
 */
const shortcutRows = (t: Record<string, unknown>): Array<[string, unknown]> => [
  [CHAR_STRINGS.ARROW_KEYS, t.keyOrbit],
  [KEYS.SLASH, t.keySearch],
  [KEYS.KEY_N.toUpperCase(), t.keyNav],
  [KEYS.KEY_O.toUpperCase(), t.keyOverview],
  [KEYS.KEY_S.toUpperCase(), t.keyScreenshot],
  [KEYS.KEY_I.toUpperCase(), t.keyInstructions],
  [CHAR_STRINGS.ESC_KEYCAP, t.keyClose],
]

/** Renders the dossier facts list — one row per {label,value} pair. A
 *  malformed dossier payload renders the rest of the panel instead of
 *  crashing the whole view. */
function renderFacts(dossier: SFDossier) {
  return (
    <dl className={SF_CLASSES.SF_FACTS}>
      {(dossier.facts ?? []).map((fact) => (
        <div key={fact.label} className={SF_CLASSES.SF_FACT}>
          <dt className={SF_CLASSES.SF_FACT_KEY}>{fact.label}</dt>
          <dd className={SF_CLASSES.SF_FACT_VAL}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Resolves a dossier media `src` — absolute http(s) URLs (remote NASA /
 * Commons streams) pass through untouched; relative paths join under the
 * module's public-asset root (`/experiments/star-field/media/…`).
 * @param src Media entry src from the dossier JSON.
 * @returns The URL to hand to img/video/audio elements.
 */
function mediaUrl(src: string): string {
  return src.startsWith(ATTR_VALUES.HTTP) ? src : `${SF_ASSET_BASE}/${src}`
}

/**
 * Renders the dossier media gallery — images as captioned figures,
 * videos with `preload="none"` so the heavy MP4s stream only on play,
 * audio the same way (the real lazy-load contract for the multi-MB
 * NASA recordings). Every asset keeps its NASA/ESA credit line.
 */
function renderMedia(dossier: SFDossier) {
  const m = dossier.media

  if (!m || (!m.images?.length && !m.videos?.length && !m.audio?.length)) return null

  return (
    <div className={SF_CLASSES.SF_MEDIA}>
      {(m.images ?? []).map((img) => (
        <figure key={img.src} className={SF_CLASSES.SF_MEDIA_FIG}>
          <img
            className={SF_CLASSES.SF_MEDIA_IMG}
            src={mediaUrl(img.src)}
            alt={img.caption ?? ATTR_VALUES.EMPTY}
            loading={ATTR_VALUES.LAZY}
          />
          {(img.caption || img.credit) && (
            <figcaption className={SF_CLASSES.SF_MEDIA_CAP}>
              {img.caption}
              {img.credit ? ` — ${img.credit}` : ATTR_VALUES.EMPTY}
            </figcaption>
          )}
        </figure>
      ))}
      {(m.videos ?? []).map((vid) => (
        <figure key={vid.src} className={SF_CLASSES.SF_MEDIA_FIG}>
          <video
            className={SF_CLASSES.SF_MEDIA_VIDEO}
            src={mediaUrl(vid.src)}
            controls
            preload={ATTR_VALUES.NONE}
            playsInline
            poster={vid.poster ? mediaUrl(vid.poster) : undefined}
          />
          {(vid.caption || vid.credit) && (
            <figcaption className={SF_CLASSES.SF_MEDIA_CAP}>
              {vid.caption}
              {vid.credit ? ` — ${vid.credit}` : ATTR_VALUES.EMPTY}
            </figcaption>
          )}
        </figure>
      ))}
      {(m.audio ?? []).map((aud) => (
        <figure key={aud.src} className={SF_CLASSES.SF_MEDIA_FIG}>
          <audio
            className={SF_CLASSES.SF_MEDIA_AUDIO}
            src={mediaUrl(aud.src)}
            controls
            preload={ATTR_VALUES.NONE}
          />
          {(aud.caption || aud.credit) && (
            <figcaption className={SF_CLASSES.SF_MEDIA_CAP}>
              {aud.caption}
              {aud.credit ? ` — ${aud.credit}` : ATTR_VALUES.EMPTY}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}

/**
 * Renders the dossier's named prose sections — deep-history bodies carry
 * titled subsections (formation, exploration, geology…) between the
 * summary paragraph and the media gallery.
 */
function renderSections(dossier: SFDossier) {
  if (!dossier.sections?.length) return null

  return (
    <div className={SF_CLASSES.SF_PANEL_SECTIONS}>
      {dossier.sections.map((sec) => (
        <section key={sec.title} className={SF_CLASSES.SF_PANEL_SEC}>
          <h3 className={SF_CLASSES.SF_PANEL_SEC_TITLE}>{sec.title}</h3>
          <p className={SF_CLASSES.SF_PANEL_SEC_BODY}>{sec.body}</p>
        </section>
      ))}
    </div>
  )
}

/**
 * Renders the provenance signature — acquisition and translation ISO
 * dates from the dossier `meta` block, so readers can audit when the
 * data was pulled and this locale's text produced.
 */
function renderSignature(dossier: SFDossier, t: Record<string, unknown>) {
  if (!dossier.meta) return null

  return (
    <p className={SF_CLASSES.SF_PANEL_SIG}>
      {t.acquired}: {dossier.meta.acquired}
      {CHAR_STRINGS.DOT_SEP} {t.translated}: {dossier.meta.translated}
    </p>
  )
}

/**
 * One registry directory row — a real focusable button per catalogued
 * object (the keyboard/AT path into all 139k bodies): display name,
 * kind badge and distance from the shard record, selecting flies the
 * camera to the rendered point and opens the synthesized dossier.
 * @param host The StarField component.
 * @param rec The registry record.
 * @param t Locale label map.
 */
function RegistryRow({
  host,
  rec,
  t,
}: {
  host: StarField
  rec: SFRegistryRecord
  t: Record<string, unknown>
}) {
  const kind = rec.i.split('-')[0]

  const techDesc = [t[kind] || kind, registryDist(rec.d), t.catalog]
    .filter(Boolean)
    .join(` ${CHAR_STRINGS.DOT_SEP} `)

  return (
    <li key={rec.i}>
      {/* Heading per registry object — the row sits under the h4 kind
          title so entries are h5; AT heading-jump lists every catalogued
          body and the wrapped button stays the activate target. */}
      <h5 className={SF_CLASSES.SF_NAV_ITEM_HEADING}>
        <button
          className={`${SF_CLASSES.SF_NAV_ITEM}${host._selectedId === rec.i ? ` ${SF_CLASSES.SF_NAV_ITEM_ACTIVE}` : ATTR_VALUES.EMPTY}`}
          type={FORM_ATTRS.BUTTON}
          aria-label={rec.n}
          aria-describedby={itemDescId(rec.i)}
          {...{ [DATA_ATTRS.DATA_BODY]: rec.i }}
          onClick={() => host._selectBody(rec.i)}
          onMouseEnter={() => host._hintBody(rec.i, rec)}
          onMouseLeave={() => host._clearHint()}
          onFocus={() => host._hintBody(rec.i, rec)}
          onBlur={() => host._clearHint()}
        >
          {rec.n}
          <span className={SF_CLASSES.SF_NAV_ITEM_META}>
            {[t[kind] || kind, registryDist(rec.d)]
              .filter(Boolean)
              .join(` ${CHAR_STRINGS.DOT_SEP} `)}
          </span>
          {/* Long-desc twin (longdesc-equivalent for a non-img control): the
              technical one-liner — localized kind · distance · region — read
              as the button's accessible description. */}
          <span className={A11Y_CLASSES.SR_ONLY} id={itemDescId(rec.i)}>
            {techDesc}
          </span>
        </button>
      </h5>
    </li>
  )
}

/**
 * Renders the StarField view.
 * @param host The StarField component.
 */
export function renderStarField(host: StarField) {
  const t: Record<string, unknown> = {
    ...SF_DEFAULTS,
    title: appText(CMS_KEYS.STAR_FIELD),
    ...(host.translations ?? {}),
  }

  const groups = sfCatalogByGroup()

  const dossier = host._dossier

  const kindLabel = dossier ? t[dossier.kind] || dossier.kind : ATTR_VALUES.EMPTY

  const menuLabel = String(appText(NAV_UI_KEYS.MENU))

  return (
    <Fragment>
      {/* Semantic index — the persistent page outline: h1, the whole
          star chart as grouped object headings on real deep links, and
          the view's command menu. sr-only keeps it out of the visual
          canvas but inside the a11y tree and the DOM, so heading maps,
          landmark lists, screen readers, crawlers and agents can
          enumerate every object and option in every chrome state. The
          objects nav goes inert while the drawer owns the same rows so
          entries are never announced twice; tabindex -1 keeps the
          hidden copies out of sequential tab order (the drawer/panel
          controls are the interactive set). */}
      <div className={A11Y_CLASSES.SR_ONLY} data-nosnippet>
        <h1>{t.title}</h1>
        <nav aria-label={String(t.explore)} inert={host._navOpen}>
          <h2>{t.explore}</h2>
          {SF_GROUP_ORDER.map((groupKey) => (
            <section key={groupKey}>
              <h3>{t[groupKey] || groupKey}</h3>
              <ul>
                {(groups.get(groupKey) ?? []).map((def) => (
                  <li key={def.id}>
                    <h4>
                      {/* Real deep link — `/star-field…/<body-slug>`
                          selects the object on load, so the index is a
                          crawlable URL set; plain clicks take the SPA
                          path (camera fly + dossier) instead. */}
                      <a
                        href={`${host._baseStarPath()}${CHAR_STRINGS.SLASH}${host._slugForId(def.id)}`}
                        tabIndex={CHAR_STRINGS.MINUS_ONE}
                        onClick={(e: Event) => {
                          if (!isPlainClick(e)) return

                          e.preventDefault()

                          host._selectBody(def.id)
                        }}
                      >
                        {host._names?.byId.get(def.id) ?? def.name}
                      </a>
                    </h4>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <section aria-label={menuLabel}>
          <h2>{menuLabel}</h2>
          <ul>
            {(
              [
                [t.explore, () => host._toggleNav()],
                [t.search, () => host._focusSearch()],
                [t.instructions, () => host._toggleInstructions()],
                [t.screenshot, () => host._takeScreenshot()],
                [t.overview, () => host._flyHome()],
              ] as Array<[unknown, () => void]>
            ).map(([label, action]) => (
              <li key={String(label)}>
                <h3>
                  <button
                    type={FORM_ATTRS.BUTTON}
                    tabIndex={CHAR_STRINGS.MINUS_ONE}
                    onClick={action}
                  >
                    {label}
                  </button>
                </h3>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* CSS+2D starfield fallback when the engine can't boot — the canvas
          is painted by fallback-stars.ts (bound from star/boot.ts), never
          a dead framebuffer. */}
      {host._sfFailed && (
        <canvas className={SF_CLASSES.SF_FALLBACK} aria-hidden={ATTR_VALUES.TRUE} />
      )}

      {/* Boot loader — dismissed on the first rendered frame (or on a
          failed boot, when the fallback takes over). Same sci-fi system
          boot structure as the earth playground loader. */}
      {!host._sfReady && (
        <div className={SF_CLASSES.SF_LOADER}>
          <div className={SF_CLASSES.SF_LOADER_GLOW} />
          <div className={SF_CLASSES.SF_LOADER_GRID} />
          <div className={SF_CLASSES.SF_LOADER_CONTENT}>
            <div className={SF_CLASSES.SF_LOADER_SPINNER_OUTER} />
            <div className={SF_CLASSES.SF_LOADER_SPINNER_INNER} />
            <div className={SF_CLASSES.SF_LOADER_COUNTER}>
              <span className={SF_CLASSES.SF_LOADER_PERCENT}>
                <span className={SF_CLASSES.SF_LOADER_VAL}>0</span>
                <span className={SF_CLASSES.SF_LOADER_SYM}>%</span>
              </span>
            </div>
            <div className={SF_CLASSES.SF_LOADER_TITLE}>{t.systemBoot}</div>
            <div className={SF_CLASSES.SF_LOADER_MSG}>
              {appText(LOADER_UI_KEYS.LOADER_INIT_WEBGPU)}
            </div>
            <div className={SF_CLASSES.SF_LOADER_BAR}>
              <div className={SF_CLASSES.SF_LOADER_BAR_FILL} />
            </div>
          </div>
        </div>
      )}

      {/* HUD — hint + aria-live announcements for hover/selection. */}
      <div className={SF_CLASSES.SF_HUD}>
        <span className={SF_CLASSES.SF_HINT}>{t.hint}</span>
        <span
          className={SF_CLASSES.SF_LIVE}
          role={ARIA_ATTRS.ROLE_STATUS}
          aria-live={ARIA_ATTRS.POLITE}
        >
          {host._liveText}
        </span>
      </div>

      {/* Hover tooltip — leader line + `{name} · {dist}` label tracking
          the picked body; positioned per-frame by _handleHoverMove. */}
      <div
        className={SF_CLASSES.SF_TIP}
        aria-hidden={ATTR_VALUES.TRUE}
        style={{ visibility: ATTR_VALUES.HIDDEN }}
      >
        <span className={SF_CLASSES.SF_TIP_LINE} />
        <span className={SF_CLASSES.SF_TIP_LABEL} />
      </div>

      {/* Navigator drawer — every body reachable by keyboard/tab. */}
      <button
        className={SF_CLASSES.SF_NAV_TOGGLE}
        type={FORM_ATTRS.BUTTON}
        aria-expanded={host._navOpen ? ATTR_VALUES.TRUE : ATTR_VALUES.FALSE}
        aria-controls={NAV_PANEL_ID}
        aria-describedby={APP_IDS.SF_NAV_DESC}
        onClick={() => host._toggleNav()}
      >
        {t.explore}
      </button>

      <nav
        className={`${SF_CLASSES.SF_NAV}${host._navOpen ? ` ${SF_CLASSES.SF_NAV_OPEN}` : ATTR_VALUES.EMPTY}`}
        aria-label={t.explore}
        aria-describedby={APP_IDS.SF_NAV_DESC}
        role={ARIA_ATTRS.ROLE_NAVIGATION}
      >
        {/* Drawer's long description — what the catalog is and what picking
            a row does; announced when the landmark or its toggle is read. */}
        <span className={A11Y_CLASSES.SR_ONLY} id={APP_IDS.SF_NAV_DESC}>
          {t.navDesc}
        </span>
        <div className={SF_CLASSES.SF_NAV_PANEL} id={NAV_PANEL_ID}>
          {/* Pinned strip — the scroll container (.sf-nav-panel) wraps the
              list only, so heading + search stay docked to the top while
              groups scroll beneath (position: sticky inside the panel). */}
          <div className={SF_CLASSES.SF_NAV_PIN}>
            <div className={SF_CLASSES.SF_NAV_HEAD}>
              <h2 className={SF_CLASSES.SF_NAV_HEADING}>{t.explore}</h2>
              <button
                className={SF_CLASSES.SF_NAV_CLOSE}
                type={FORM_ATTRS.BUTTON}
                aria-label={appText(NAV_UI_KEYS.CLOSE)}
                onClick={() => host._toggleNav()}
              >
                ✕
              </button>
            </div>
            <input
              className={SF_CLASSES.SF_NAV_SEARCH}
              type={FORM_ATTRS.SEARCH}
              name={FORM_ATTRS.SEARCH}
              placeholder={t.search}
              aria-label={t.search}
              value={host._search}
              onInput={(e: Event) => host._setSearch((e.target as HTMLInputElement).value)}
            />
          </div>
          {SF_GROUP_ORDER.map((groupKey) => {
            const defs = (groups.get(groupKey) ?? []).filter((def) => host._matchesSearch(def))

            // Empty groups render their header while browsing (they may
            // just be unloaded), but collapse away while a search
            // filter is active so results stay scannable.
            if (!defs.length && host._search.trim()) return null

            return (
              <section key={groupKey} className={SF_CLASSES.SF_NAV_GROUP}>
                <h3 className={SF_CLASSES.SF_NAV_GROUP_TITLE}>{t[groupKey] || groupKey}</h3>
                <ul className={SF_CLASSES.SF_NAV_LIST}>
                  {defs.map((def) => {
                    const bodyName = host._names?.byId.get(def.id) ?? def.name

                    return (
                      <li key={def.id}>
                        {/* Heading per charted object — the group title is
                            h3 so entries are h4; AT heading-jump lists every
                            body by name and the wrapped button stays the
                            activate target. */}
                        <h4 className={SF_CLASSES.SF_NAV_ITEM_HEADING}>
                          <button
                            className={`${SF_CLASSES.SF_NAV_ITEM}${host._selectedId === def.id ? ` ${SF_CLASSES.SF_NAV_ITEM_ACTIVE}` : ATTR_VALUES.EMPTY}`}
                            type={FORM_ATTRS.BUTTON}
                            aria-label={bodyName}
                            aria-describedby={itemDescId(def.id)}
                            {...{ [DATA_ATTRS.DATA_BODY]: def.id }}
                            onClick={() => host._selectBody(def.id)}
                            onMouseEnter={() => host._hintBody(def.id)}
                            onMouseLeave={() => host._clearHint()}
                            onFocus={() => host._hintBody(def.id)}
                            onBlur={() => host._clearHint()}
                          >
                            {bodyName}
                            <span className={SF_CLASSES.SF_NAV_ITEM_META}>
                              {[t[def.kind] || def.kind, def.dist]
                                .filter(Boolean)
                                .join(` ${CHAR_STRINGS.DOT_SEP} `)}
                            </span>
                            {/* Long-desc twin — the technical line: localized
                                kind · distance · region group. */}
                            <span className={A11Y_CLASSES.SR_ONLY} id={itemDescId(def.id)}>
                              {[t[def.kind] || def.kind, def.dist, t[groupKey] || groupKey]
                                .filter(Boolean)
                                .join(` ${CHAR_STRINGS.DOT_SEP} `)}
                            </span>
                          </button>
                        </h4>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}

          {/* Deep catalog — the 139k-object registry. With a query the
              incremental shard search lists matches across all kinds;
              without one, each kind shows its loaded records plus a
              "load more" affordance (1,000 records per shard fetch). */}
          {host._regManifest?.total != null && (
            <section className={SF_CLASSES.SF_NAV_GROUP}>
              <h3 className={SF_CLASSES.SF_NAV_GROUP_TITLE}>
                {t.catalog}
                <span className={SF_CLASSES.SF_NAV_ITEM_META}>
                  {` ${host._regManifest.total.toLocaleString()} ${t.records}`}
                </span>
              </h3>
              {host._search.trim() ? (
                <ul className={SF_CLASSES.SF_NAV_LIST}>
                  {(host._regSearch ?? []).map((rec) => (
                    <RegistryRow host={host} rec={rec} t={t} />
                  ))}
                  {host._regSearching && (
                    <li className={SF_CLASSES.SF_NAV_ITEM_META}>{t.searching}</li>
                  )}
                </ul>
              ) : (
                SF_STAR_CLOUD.REGISTRY_KINDS.map((kind) => {
                  const info = host._regManifest?.kinds?.[kind]

                  if (!info?.shards) return null

                  const loaded = host._regRecords.get(kind) ?? []

                  const loadedShards = host._regLoaded.get(kind) ?? 0

                  return (
                    <div key={kind} className={SF_CLASSES.SF_NAV_GROUP}>
                      <h4 className={SF_CLASSES.SF_NAV_GROUP_TITLE}>
                        {t[kind] || kind}
                        <span className={SF_CLASSES.SF_NAV_ITEM_META}>
                          {` ${info.count.toLocaleString()} ${t.records}`}
                        </span>
                      </h4>
                      <ul className={SF_CLASSES.SF_NAV_LIST}>
                        {loaded.map((rec) => (
                          <RegistryRow host={host} rec={rec} t={t} />
                        ))}
                      </ul>
                      {loadedShards < info.shards.length && (
                        <button
                          className={SF_CLASSES.SF_NAV_MORE}
                          type={FORM_ATTRS.BUTTON}
                          onClick={() => host._loadMoreRegistry(kind)}
                        >
                          {t.loadMore}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </section>
          )}

          {/* Mobile home for the scale disclaimer — the pinned strip is
              display:none under 768px so the bottom edge stays clear;
              the drawer keeps the honesty note one gesture away. */}
          <p className={SF_CLASSES.SF_NAV_DISCLAIMER}>{t.disclaimer}</p>
        </div>
      </nav>

      {/* Dossier info panel — opens on selection; content lazily filled. */}
      <aside
        className={`${SF_CLASSES.SF_PANEL}${host._selectedId ? ` ${SF_CLASSES.SF_PANEL_OPEN}` : ATTR_VALUES.EMPTY}`}
        aria-live={ARIA_ATTRS.POLITE}
        aria-labelledby={APP_IDS.SF_PANEL_TITLE}
        aria-describedby={APP_IDS.SF_PANEL_TAGLINE}
        inert={!host._selectedId}
      >
        <header className={SF_CLASSES.SF_PANEL_HEAD}>
          <h2 className={SF_CLASSES.SF_PANEL_TITLE} id={APP_IDS.SF_PANEL_TITLE}>
            {dossier?.name ?? ATTR_VALUES.EMPTY}
          </h2>
          {dossier && <span className={SF_CLASSES.SF_PANEL_TAG}>{kindLabel}</span>}
          <button
            className={SF_CLASSES.SF_PANEL_CLOSE}
            type={FORM_ATTRS.BUTTON}
            aria-label={appText(NAV_UI_KEYS.CLOSE)}
            onClick={() => host._closePanel()}
          >
            ✕
          </button>
        </header>
        <div className={SF_CLASSES.SF_PANEL_BODY}>
          {host._dossierLoading && <p className={SF_CLASSES.SF_PANEL_LOADING}>{t.loading}</p>}
          {dossier && (
            <Fragment>
              <p className={SF_CLASSES.SF_PANEL_TAGLINE} id={APP_IDS.SF_PANEL_TAGLINE}>
                {dossier.tagline}
              </p>
              {renderFacts(dossier)}
              <p className={SF_CLASSES.SF_PANEL_HISTORY}>{dossier.history}</p>
              {renderSections(dossier)}
              {renderMedia(dossier)}
              <p className={SF_CLASSES.SF_PANEL_SOURCE}>
                {t.source}: {dossier.source}
              </p>
              {renderSignature(dossier, t)}
            </Fragment>
          )}
        </div>
      </aside>

      {/* Scale disclaimer — honesty note pinned to the bottom edge. */}
      <p className={SF_CLASSES.SF_DISCLAIMER}>{t.disclaimer}</p>

      {/* Actions */}
      <div className={SF_CLASSES.SF_ACTIONS}>
        <button
          className={`${SF_CLASSES.SF_BTN} ${SF_CLASSES.SF_INSTRUCTIONS_BTN}`}
          type={FORM_ATTRS.BUTTON}
          aria-expanded={host._instructionsOpen ? ATTR_VALUES.TRUE : ATTR_VALUES.FALSE}
          aria-controls={APP_IDS.SF_INSTRUCTIONS_PANEL}
          onClick={() => host._toggleInstructions()}
        >
          {t.instructions}
        </button>
        <button
          className={SF_CLASSES.SF_BTN}
          type={FORM_ATTRS.BUTTON}
          onClick={() => host._takeScreenshot()}
        >
          {t.screenshot}
        </button>
        <button
          className={SF_CLASSES.SF_BTN}
          type={FORM_ATTRS.BUTTON}
          onClick={() => host._flyHome()}
        >
          {t.overview}
        </button>
      </div>

      {/* "Featured on Three.js Resources" showcase badge — pinned below
          the site logo in the content gutter. A real deep link keeps the
          credit crawlable; the chip shares the glass chrome tokens and
          sits under the nav drawer's z-layer so it never blocks scene
          or drawer interaction. */}
      <a
        className={SF_CLASSES.SF_BADGE}
        href={SF_BADGE.SHOWCASE}
        target={DOM_STRINGS.BLANK}
        rel={DOM_STRINGS.NOOPENER}
      >
        <img
          className={SF_CLASSES.SF_BADGE_LOGO}
          src={SF_BADGE.LOGO}
          alt="Three.js Resources logo"
          decoding={MEDIA_ATTRS.DECODING_ASYNC}
        />
        <span className={SF_CLASSES.SF_BADGE_COPY}>
          <span className={SF_CLASSES.SF_BADGE_EYEBROW}>Featured on</span>
          <span className={SF_CLASSES.SF_BADGE_NAME}>Three.js Resources</span>
        </span>
      </a>

      {/* Ambient playlist — a button per track feeding the persistent
          native <audio> mounted by star/music.ts (play/seek/volume stay
          the browser's accessible controls; `ended` auto-advances and
          wraps so the soundtrack chains). Autoplay is suppressed under
          reduced-motion — AT sessions start silent, press-to-play stays
          available. */}
      <div className={SF_CLASSES.SF_MUSIC}>
        <span className={A11Y_CLASSES.SR_ONLY} id={`${SF_CLASSES.SF_MUSIC}-desc`}>
          {t.musicDesc}
        </span>
        <ul className={SF_CLASSES.SF_MUSIC_LIST} aria-label={t.music}>
          {SF_MUSIC_TRACKS.map((track, index) => (
            <li key={track.src}>
              <button
                className={`${SF_CLASSES.SF_MUSIC_TRACK}${host._musicIndex === index ? ` ${SF_CLASSES.SF_MUSIC_TRACK_ACTIVE}` : ATTR_VALUES.EMPTY}`}
                type={FORM_ATTRS.BUTTON}
                aria-pressed={host._musicIndex === index ? ATTR_VALUES.TRUE : ATTR_VALUES.FALSE}
                aria-describedby={`${SF_CLASSES.SF_MUSIC}-desc`}
                onClick={() => host._playMusic(index)}
              >
                {track.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Instructions modal — auto closes on interaction; the same sheet
          documents the keyboard map so shortcuts are discoverable from
          the UI, not just the handler. */}
      {host._instructionsOpen && (
        <div
          className={`${SF_CLASSES.SF_INSTRUCTIONS_MODAL} ${SF_CLASSES.SF_INSTRUCTIONS_MODAL_OPEN}`}
          id={APP_IDS.SF_INSTRUCTIONS_PANEL}
          role={ARIA_ATTRS.ROLE_DIALOG}
          aria-label={String(t.instructions)}
          aria-describedby={APP_IDS.SF_INSTRUCTIONS_HINT}
        >
          <div className={SF_CLASSES.SF_INSTRUCTIONS_HEAD}>
            <span className={SF_CLASSES.SF_INSTRUCTIONS_TITLE}>{t.instructions}</span>
            <button
              className={SF_CLASSES.SF_INSTRUCTIONS_CLOSE}
              type={FORM_ATTRS.BUTTON}
              aria-label={appText(NAV_UI_KEYS.CLOSE)}
              onClick={() => host._closeInstructions()}
            >
              ✕
            </button>
          </div>
          <div className={SF_CLASSES.SF_INSTRUCTIONS_BODY}>
            <p className={SF_CLASSES.SF_INSTRUCTIONS_HINT} id={APP_IDS.SF_INSTRUCTIONS_HINT}>
              {t.hint}
            </p>
            <h3 className={SF_CLASSES.SF_INSTRUCTIONS_TITLE}>{t.shortcuts}</h3>
            <dl className={SF_CLASSES.SF_INSTRUCTIONS_KEYS}>
              {shortcutRows(t).map(([keycap, action]) => (
                <div className={SF_CLASSES.SF_INSTRUCTIONS_KEY} key={keycap}>
                  <dt>
                    <kbd className={SF_CLASSES.SF_INSTRUCTIONS_KEYCAP}>{keycap}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
            <p className={SF_CLASSES.SF_INSTRUCTIONS_DISCLAIMER}>{t.disclaimer}</p>
          </div>
        </div>
      )}
    </Fragment>
  )
}
