/**
 * @file StarField.tsx
 * @description <view-star-field> — the star-field experiment route: a
 * three.js voyage from the Solar System out through the Milky Way's
 * famous systems and nebulae to the Andromeda galaxy. Bodies are
 * reachable two ways — pointer picking on the canvas, or the navigator
 * drawer (one focusable button per body, the keyboard/AT path) — and each
 * lazy-loads its dossier JSON into the info panel on approach/select.
 * The loader stays up until the first rendered frame; when WebGL can't
 * boot a CSS starfield fallback renders instead.
 */
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { KEYS } from '@core/tokens/primitives.js'
import { KEYBOARD_EVENTS } from '@core/tokens/events/dom.js'
import { h } from '@core/jsx.js'
import { BaseComponent } from '@core/Component.js'
import store from '@core/store.js'
import { StarFieldEngine } from './starfield-engine.js'
import { renderStarField } from './star/render.js'
import { dismissStarLoader, initStarFieldEngine, updateStarLoader } from './star/boot.js'
import { applyStarTranslations, loadStarTranslations } from './star/i18n.js'
import { applyDossierLocale, fetchDossier, loadDossier } from './star/dossier.js'
import { sfCatalogByGroup } from './engine/catalog.js'
import {
  ensureRegistryManifest,
  isRegistryId,
  loadRegistryShard,
  searchRegistry,
} from './engine/registry.js'
import type { SFRegistryManifest, SFRegistryRecord } from './engine/registry.js'
import { SF_KEYS } from '@core/tokens/starfield/params.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import router from '@core/router/router.js'
import type { RouteDescriptor } from '@core/router/types.js'
import type { SFDossier } from './engine/types.js'
import sfStyles from './star-field.scss?inline'

// ─── Star Field ──────────────────────────────────────────────────────────────
// Immersive full-screen star chart as a standalone experience. Facade/state
// holder — boot/i18n/dossier/render split under star/ and the three.js scene
// under engine/.

/** Pre-built id → display-name lookup for live announcements. */
const _NAME_BY_ID = new Map(
  [...sfCatalogByGroup().values()].flat().map((def) => [def.id, def.name])
)

/** Pre-built id → `{name} · {dist}` hover tooltip text lookup. */
const _TIP_BY_ID = new Map(
  [...sfCatalogByGroup().values()]
    .flat()
    .map((def): [string, string] => [def.id, `${def.name} ${CHAR_STRINGS.DOT_SEP} ${def.dist}`])
)

/** Pre-built id → distance-label lookup for tooltip upgrades. */
const _DIST_BY_ID = new Map(
  [...sfCatalogByGroup().values()].flat().map((def): [string, string] => [def.id, def.dist])
)

/**
 * Arrow-key → view-rotation delta map — left/right change azimuth,
 * up/down change polar (up lifts the camera = negative polar step).
 */
const _ARROW_DELTAS: Record<string, [number, number]> = {
  [KEYS.ARROW_LEFT]: [-SF_KEYS.AZIMUTH, 0],
  [KEYS.ARROW_RIGHT]: [SF_KEYS.AZIMUTH, 0],
  [KEYS.ARROW_UP]: [0, -SF_KEYS.POLAR],
  [KEYS.ARROW_DOWN]: [0, SF_KEYS.POLAR],
}

/**
 * The StarField — a full-viewport explorable star chart.
 */
export class StarField extends BaseComponent {
  _engine: StarFieldEngine | null = null // three.js engine instance
  _canvasEl: HTMLCanvasElement | null = null // persistent render canvas
  _isInitializing = false // re-entrancy guard while init() is in flight
  _sfReady = false // first usable frame delivered — loader dismisses
  _sfFailed = false // engine boot failed — CSS fallback renders instead
  _fallbackDispose: (() => void) | null = null // 2D fallback resize-observer cleanup
  _navOpen = false // navigator drawer open state
  _search = '' // navigator directory filter query
  _selectedId: string | null = null // dossier panel body id
  _dossier: SFDossier | null = null // locale dossier for the panel
  _dossierLoading = false // dossier fetch in flight — panel shows loading
  _liveText = '' // aria-live announcements (hover/selection names)
  _lastLocale: string | null = null // locale the labels were last fetched for
  translations: Record<string, unknown> | null = null // pages/star-field label node
  _onKeyDown: ((e: Event) => void) | null = null // Escape + arrow-keys handler
  _regManifest: SFRegistryManifest | null = null // index manifest (kinds + counts)
  _regLoading = false // manifest fetch in flight
  _regLoaded = new Map<string, number>() // kind → shards fetched so far
  _regRecords = new Map<string, SFRegistryRecord[]>() // kind → loaded records
  _regSearch: SFRegistryRecord[] | null = null // active registry search results
  _regSearching = false // registry search in flight
  _regQuery = '' // last registry search query (stale-response guard)

  constructor() {
    super(sfStyles)
  }

  /** The render canvas the engine draws into — kept across re-renders. */

  _getCanvasEl() {
    if (!this._canvasEl) {
      this._canvasEl = document.createElement(HTML_TAGS.CANVAS)

      this._canvasEl.className = SF_CLASSES.SF_CANVAS

      this._canvasEl.setAttribute(ARIA_ATTRS.ARIA_HIDDEN, ATTR_VALUES.TRUE)
    }

    return this._canvasEl
  }

  /** Lifecycle: subscribes, mounts the canvas, loads labels, boots the engine. */

  override onMounted() {
    this.subscribe(store)

    const canvas = this._getCanvasEl()

    if (this.shadowRoot && !this.shadowRoot.contains(canvas)) {
      this.shadowRoot?.insertBefore(canvas, this._contentNode)
    }

    this._loadTranslations()

    this._initEngine()

    this._bindKeys()
  }

  /** Lifecycle: re-mounts the canvas after re-render + re-inits if needed. */

  override onUpdated() {
    const canvas = this._getCanvasEl()

    if (this.shadowRoot && !this.shadowRoot.contains(canvas)) {
      this.shadowRoot?.insertBefore(canvas, this._contentNode)
    }

    if (!this._engine && !this._isInitializing) {
      this._initEngine()
    }
  }

  /** Lifecycle: destroys the engine and unbinds the Escape handler. */

  override onDestroy() {
    this._engine?.destroy()

    this._engine = null

    this._canvasEl = null

    this._isInitializing = false

    this._sfReady = false

    this._sfFailed = false

    this._fallbackDispose?.()

    this._fallbackDispose = null

    if (this._onKeyDown) {
      document.removeEventListener(KEYBOARD_EVENTS.KEYDOWN, this._onKeyDown)

      this._onKeyDown = null
    }
  }

  /** Re-fetches labels + re-derives the open dossier on locale change. */

  override onStoreUpdate() {
    const currentLocale = store.getters.getLang()

    if (this._lastLocale && this._lastLocale !== currentLocale) {
      this._loadTranslations()

      applyDossierLocale(this)
    }
  }

  /** Loads the star-field label translations via SWR. */

  _loadTranslations() {
    loadStarTranslations(this)
  }

  /** Stores the fetched pages/star-field node and re-renders. */

  _applyTranslations(val: Record<string, unknown> | null | undefined): void {
    applyStarTranslations(this, val)
  }

  /** Mirrors engine bootstrap progress into the loader overlay. */

  _updateLoader(msg: string, pct: number): void {
    updateStarLoader(this, msg, pct)
  }

  /** Creates the engine with ready/select/approach/hover callbacks. */

  _initEngine() {
    initStarFieldEngine(this)
  }

  /** Hides the loading overlay after the first usable frame. */

  _dismissLoader() {
    dismissStarLoader(this)
  }

  /**
   * Binds the document-level keyboard map — Escape dismisses (panel,
   * then drawer) and the arrow keys orbit the camera, so the chart is
   * fully navigable without pointer input even when nothing inside the
   * view holds focus.
   */

  _bindKeys() {
    if (this._onKeyDown) return

    this._onKeyDown = (e: Event) => {
      const key = (e as KeyboardEvent).key

      if (key === KEYS.ESCAPE) {
        if (this._selectedId) {
          this._closePanel()
        } else if (this._navOpen) {
          this._toggleNav()
        }

        return
      }

      const delta = _ARROW_DELTAS[key]

      if (delta && this._engine) {
        e.preventDefault()

        this._engine.rotateView(delta[0], delta[1])
      }
    }

    document.addEventListener(KEYBOARD_EVENTS.KEYDOWN, this._onKeyDown)
  }

  /**
   * Search-filter setter — re-renders the navigator list narrowed to
   * bodies whose catalog name or id contains the query (case-folded),
   * so 66+ bodies stay browsable. Non-trivial queries also fire the
   * incremental registry search over the 139k catalogue; the query
   * guard keeps a slow earlier response from overwriting a newer one.
   * @param q Raw input value from the drawer search field.
   */

  _setSearch(q: string) {
    this._search = q

    this._ensureRegistry()

    const query = q.trim()

    this._regQuery = query

    if (!query) {
      this._regSearch = null
      this._regSearching = false

      this._updateDom()

      return
    }

    this._regSearching = true

    void searchRegistry(query).then((recs) => {
      if (this._regQuery !== query) return

      this._regSearch = recs
      this._regSearching = false

      this._updateDom()
    })
  }

  /**
   * Lazily resolves the registry manifest — fired the first time the
   * drawer opens or a search starts, so the 139k index metadata costs
   * nothing for users who never browse the catalogue.
   */

  _ensureRegistry() {
    if (this._regManifest || this._regLoading) return

    this._regLoading = true

    void ensureRegistryManifest().then((manifest) => {
      this._regManifest = manifest
      this._regLoading = false

      this._updateDom()
    })
  }

  /**
   * Incremental catalogue browsing — fetches the next 1,000-record
   * shard for a kind and appends it to the drawer's loaded list. Each
   * shard is one ~100 KB fetch; records accumulate so "load more"
   * never refetches earlier pages.
   * @param kind Registry kind (`star`/`exoplanet`/`dso`).
   */

  _loadMoreRegistry(kind: string) {
    const loaded = this._regLoaded.get(kind) ?? 0

    const shards = this._regManifest?.kinds[kind]?.shards.length ?? 0

    if (loaded >= shards) return

    this._regLoaded.set(kind, loaded + 1)

    void loadRegistryShard(kind, loaded).then((recs) => {
      if (!recs) return

      const list = this._regRecords.get(kind) ?? []

      this._regRecords.set(kind, [...list, ...recs])

      this._updateDom()
    })
  }

  /** Opens the drawer and starts the manifest fetch in one gesture. */

  _toggleNav() {
    this._navOpen = !this._navOpen

    if (this._navOpen) this._ensureRegistry()

    this._updateDom()
  }

  /**
   * Drawer filter predicate — matches on catalog name or id; an empty
   * query passes everything.
   * @param def Catalog entry under test.
   */

  _matchesSearch(def: { id: string; name: string }): boolean {
    const q = this._search.trim().toLowerCase()

    return !q || def.name.toLowerCase().includes(q) || def.id.toLowerCase().includes(q)
  }

  /**
   * Selection entry point — shared by nav buttons and canvas picking:
   * loads the dossier panel and flies the camera to the body.
   * @param id Catalog body id.
   */

  _selectBody(id: string) {
    this._engine?.selectBody(id)

    loadDossier(this, id)

    this._announce(id)

    this._syncUrl(id)
  }

  /** Closes the dossier panel and clears the selection. */

  _closePanel() {
    this._selectedId = null

    this._dossier = null

    this._dossierLoading = false

    this._syncUrl(null)

    this._updateDom()
  }

  /**
   * Current-route base path — the star-field URL minus a trailing
   * `/<body>` segment, so deep-link navigation always composes from the
   * chart root rather than stacking body segments.
   * @returns The chart base path in the active locale.
   */
  _baseStarPath(): string {
    const route = router.currentRoute

    const path = route?.path ?? CHAR_STRINGS.EMPTY

    const body = route?.params?.body

    return body && path.endsWith(`${CHAR_STRINGS.SLASH}${body}`)
      ? path.slice(0, -(body.length + 1))
      : path
  }

  /**
   * Keeps the address bar in sync with the selection — selecting pushes
   * `…/<body>` so Back returns to the chart, closing returns to the base
   * chart URL. Skips when the current route already carries the target
   * so the param-change echo (`onRouteParamChange`) cannot loop.
   * @param id Newly selected body id, or null after close.
   */
  _syncUrl(id: string | null): void {
    const route = router.currentRoute

    if (!route || route.view !== VIEW_TAGS.VIEW_STAR_FIELD) return

    if ((route.params?.body ?? null) === id) return

    const base = this._baseStarPath()

    void router.handleNavigation(id ? `${base}${CHAR_STRINGS.SLASH}${id}` : base)
  }

  /**
   * Router param echo — same-view navigation delivers the new descriptor
   * here: a valid `body` param selects it (idempotent on repeat), its
   * absence closes the panel. Unknown ids degrade to the plain chart so
   * stale or hand-typed URLs never break the view.
   * @param _route The destination descriptor (unused — reads
   * `router.currentRoute` directly, see below).
   */
  onRouteParamChange(_route: RouteDescriptor | null): void {
    // Read the authoritative current route, not the delivered
    // descriptor: same-view pushes are async, so a stale echo from an
    // earlier push (e.g. select→close racing) would otherwise
    // re-select a body the user already dismissed.
    const latest = router.currentRoute

    const body = latest && latest.view === VIEW_TAGS.VIEW_STAR_FIELD ? latest.params?.body : null

    if (body && (_NAME_BY_ID.has(body) || isRegistryId(body))) {
      if (this._selectedId !== body) this._selectBody(body)

      return
    }

    if (!body && this._selectedId) this._closePanel()
  }

  /**
   * Deep-link entry — after the engine reports ready, selects the body
   * named in the URL (flies the camera + opens the dossier). Falls back
   * silently to the overview chart on unknown ids.
   */
  _applyDeepLink(): void {
    const body = router.currentRoute?.params?.body

    if (body && (_NAME_BY_ID.has(body) || isRegistryId(body))) this._selectBody(body)
  }

  /** Downloads the current frame as a PNG. */

  _takeScreenshot() {
    this._engine?.takeScreenshot()
  }

  /** Returns the camera to the overview pose. */

  _flyHome() {
    this._engine?.flyHome()
  }

  /**
   * Hover announce — updates the aria-live HUD text when the pointer
   * crosses a body so screen readers and the HUD chip both learn it.
   * @param id Hovered body id, or null on leaving.
   */

  _handleHover(id: string | null) {
    const text = id ? (_NAME_BY_ID.get(id) ?? '') : ''

    this._syncTip(id, text)

    if (id) {
      // Hover warms the dossier cache (selection then resolves instantly)
      // and upgrades the tooltip to the localized body name on resolve.
      fetchDossier(id).then((file) => {
        const name = file?.name

        if (name && this._liveText === (_NAME_BY_ID.get(id) ?? '')) {
          const tip = this.$(`.${SF_CLASSES.SF_TIP}`) as HTMLElement | null

          const label = tip?.querySelector(`.${SF_CLASSES.SF_TIP_LABEL}`)

          const def = _DIST_BY_ID.get(id)

          if (label) label.textContent = def ? `${name} ${CHAR_STRINGS.DOT_SEP} ${def}` : name
        }
      })
    }

    if (text === this._liveText) return

    this._liveText = text

    const live = this.$(`.${SF_CLASSES.SF_LIVE}`)

    if (live) live.textContent = text
  }

  /**
   * Tooltip label sync — writes `{name} · {dist}` into the leader-line
   * tooltip and shows it while a body is hovered; hides it on leave.
   * Direct DOM writes (like the live region) so per-frame tracking never
   * triggers a full re-render.
   * @param id Hovered body id, or null on leaving.
   * @param text Resolved display text (for the early-return guard).
   */

  _syncTip(id: string | null, text: string) {
    const tip = this.$(`.${SF_CLASSES.SF_TIP}`) as HTMLElement | null

    if (!tip) return

    if (!id) {
      tip.setAttribute(ARIA_ATTRS.ARIA_HIDDEN, ATTR_VALUES.TRUE)

      tip.style.visibility = ATTR_VALUES.HIDDEN

      return
    }

    const label = tip.querySelector(`.${SF_CLASSES.SF_TIP_LABEL}`)

    const tipText = _TIP_BY_ID.get(id) ?? text

    if (label) label.textContent = tipText

    tip.style.visibility = ATTR_VALUES.VISIBLE

    tip.removeAttribute(ARIA_ATTRS.ARIA_HIDDEN)
  }

  /**
   * Per-frame hover tracking — the engine reports the hovered body's
   * projected canvas-space pixel position every tick; the tooltip root
   * is translate-positioned so the leader line + label orbit with it.
   * @param id Hovered body id.
   * @param x Canvas-space x in px.
   * @param y Canvas-space y in px.
   */

  _handleHoverMove(id: string, x: number, y: number) {
    const tip = this.$(`.${SF_CLASSES.SF_TIP}`) as HTMLElement | null

    if (!tip) return

    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  /** Announces a selection through the same live region. */

  /** Announces a selection through the same live region. */

  _announce(id: string) {
    const name = _NAME_BY_ID.get(id) ?? ''

    this._liveText = name

    const live = this.$(`.${SF_CLASSES.SF_LIVE}`)

    if (live) live.textContent = name
  }

  override render() {
    return renderStarField(this)
  }
}

if (!customElements.get(VIEW_TAGS.VIEW_STAR_FIELD)) {
  customElements.define(VIEW_TAGS.VIEW_STAR_FIELD, StarField)
}
