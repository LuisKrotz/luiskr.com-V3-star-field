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
import { KEYBOARD_EVENTS, POINTER_EVENTS } from '@core/tokens/events/dom.js'
import { h } from '@core/jsx.js'
import { BaseComponent } from '@core/Component.js'
import store from '@core/store.js'
import { StarFieldEngine } from './starfield-engine.js'
import { renderStarField } from './star/render.js'
import {
  bindFallbackField,
  dismissStarLoader,
  initStarFieldEngine,
  updateStarLoader,
} from './star/boot.js'
import { applyStarTranslations, loadStarTranslations } from './star/i18n.js'
import { applyDossierLocale, fetchBodyNames, fetchDossier, loadDossier } from './star/dossier.js'
import type { SFBodyNames } from './star/dossier.js'
import { sfCatalogByGroup } from './engine/catalog.js'
import {
  ensureRegistryManifest,
  isRegistryId,
  loadRegistryShard,
  searchRegistry,
} from './engine/registry.js'
import type { SFRegistryManifest, SFRegistryRecord } from './engine/registry.js'
import { SF_BODY_IDS, SF_KEYS } from '@core/tokens/starfield/params.js'
import { SF_CSS_PROPS } from '@core/tokens/css/starfield.js'
import { BREAKPOINTS } from '@core/tokens/layout/breakpoints.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { applyAnimationDesc } from '@core/utils/a11y/animation-desc.js'
import { ANIMATION_IDS } from '@core/tokens/data/animation-ids.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { slugify } from '@core/utils/string.js'
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
 * Printable-key → action shortcut map — `/` opens the navigator with the
 * catalog search focused, `n` toggles it, `o` flies home, `s` saves a
 * frame and `i` toggles the instructions sheet. Keys are matched
 * case-folded and only with no Ctrl/Meta/Alt held so browser and OS
 * chords pass straight through.
 */
const _HOTKEY_ACTIONS: Readonly<Record<string, (host: StarField) => void>> = Object.freeze({
  [KEYS.SLASH]: (host) => host._focusSearch(),
  [KEYS.KEY_N]: (host) => host._toggleNav(),
  [KEYS.KEY_O]: (host) => host._flyHome(),
  [KEYS.KEY_S]: (host) => host._takeScreenshot(),
  [KEYS.KEY_I]: (host) => host._toggleInstructions(),
})

/** Field tags whose focus means a keystroke is typing, not a shortcut. */
const _TYPING_TAGS: ReadonlySet<string> = new Set([
  HTML_TAGS.INPUT,
  HTML_TAGS.TEXTAREA,
  HTML_TAGS.SELECT,
])

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
  _instructionsOpen = false // instructions modal open state (mobile)
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
  _names: SFBodyNames | null = null // locale body-name table (id↔slug)
  _namesReady: Promise<unknown> = Promise.resolve() // in-flight names fetch

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

    // The persistent scene canvas IS the animation — described once it
    // sits inside the shadow root so the shared node resolves in-tree.
    applyAnimationDesc(canvas, ANIMATION_IDS.SCENE_3D)

    this.shadowRoot?.addEventListener(POINTER_EVENTS.POINTERDOWN, (e: Event) => {
      const target = e.target as HTMLElement | null

      if (
        !target?.closest(`.${SF_CLASSES.SF_INSTRUCTIONS_MODAL}`) &&
        !target?.closest(`.${SF_CLASSES.SF_INSTRUCTIONS_BTN}`)
      ) {
        this._closeInstructions()
      }
    })

    this._loadTranslations()

    this._loadBodyNames()

    this._initEngine()

    this._bindKeys()
  }

  /** Lifecycle: re-mounts the canvas after re-render + re-inits if needed. */

  override onUpdated() {
    const canvas = this._getCanvasEl()

    if (this.shadowRoot && !this.shadowRoot.contains(canvas)) {
      this.shadowRoot?.insertBefore(canvas, this._contentNode)
    }

    // Every _updateDom rebuild replaces the .sf-fallback canvas node —
    // re-bind so the fresh canvas is painted + observed (the previous
    // node's paint and resize observer die with the rebuild).
    if (this._sfFailed) bindFallbackField(this)

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

      this._loadBodyNames()

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

  /**
   * Loads the locale body-name table (`data/<locale>/names.json`) —
   * cached per locale by dossier.ts. On resolve the drawer re-renders
   * localized rows and the open selection's URL segment is re-synced so
   * a selection made before the map landed still gets its translated
   * route name. `_namesReady` lets `_applyDeepLink`/`onRouteParamChange`
   * defer slug resolution until the table exists.
   */

  _loadBodyNames(): void {
    this._namesReady = fetchBodyNames().then((names) => {
      this._names = names

      if (this._selectedId) this._syncUrl(this._selectedId)

      this._updateDom()
    })
  }

  /**
   * Resolves a route `body` segment to a catalog id — accepts the raw
   * id (`vesta`), a registry id (`star-NNNNNN`), or a slugified
   * localized name from the loaded names table (`via-lactea`).
   * @param param The `body` route param.
   * @returns The catalog id, or null when unresolvable.
   */

  _resolveBodyParam(param: string | undefined | null): string | null {
    if (!param) return null

    if (_NAME_BY_ID.has(param) || isRegistryId(param)) return param

    return this._names?.bySlug.get(param) ?? null
  }

  /**
   * Route segment for a body — the slugified localized name once the
   * names table has landed (`Via Láctea` → `via-lactea`), the raw id
   * before. The raw id is itself a valid segment (slugify folds it to
   * itself), so a pre-map selection stays resolvable.
   * @param id Catalog body id.
   * @returns The URL segment to write.
   */

  _slugForId(id: string): string {
    const name = this._names?.byId.get(id)

    return (name && slugify(name)) || id
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
      const ke = e as KeyboardEvent

      if (ke.key === KEYS.ESCAPE) {
        if (this._instructionsOpen) {
          this._closeInstructions()
        } else if (this._selectedId) {
          this._closePanel()
        } else if (this._navOpen) {
          this._toggleNav()
        }

        return
      }

      const delta = _ARROW_DELTAS[ke.key]

      if (delta && this._engine && !this._isTyping()) {
        e.preventDefault()

        this._closeInstructions()

        this._engine.rotateView(delta[0], delta[1])

        return
      }

      // Single-key shortcuts — skipped when a modifier is held (browser/
      // OS chords pass through) and while a field in the shadow tree has
      // focus, so catalog typing never fires a shortcut.
      if (ke.ctrlKey || ke.metaKey || ke.altKey || this._isTyping()) return

      const action = _HOTKEY_ACTIONS[ke.key.toLowerCase()]

      if (!action) return

      e.preventDefault()

      action(this)
    }

    document.addEventListener(KEYBOARD_EVENTS.KEYDOWN, this._onKeyDown)
  }

  /**
   * Typing guard — true while the shadow root's focused element is a text
   * field or editable region, so `/` and the letter shortcuts never steal
   * input from the catalog search (or any future field).
   * @returns Whether keystrokes should be treated as typing.
   */
  _isTyping(): boolean {
    const el = this.shadowRoot?.activeElement as HTMLElement | null

    return !!el && (_TYPING_TAGS.has(el.tagName.toLowerCase()) || el.isContentEditable === true)
  }

  /**
   * `/` shortcut — opens the navigator drawer (starting the lazy registry
   * manifest too) and moves focus straight into the catalog search, the
   * one-gesture path into a targeted body lookup.
   */
  _focusSearch() {
    if (!this._navOpen) {
      this._navOpen = true

      this._ensureRegistry()
    }

    this._updateDom()

    const input = this.$(`.${SF_CLASSES.SF_NAV_SEARCH}`) as HTMLInputElement | null

    input?.focus()
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

      // _updateDom carries the panel scroll offset across the rebuild,
      // so appending the shard never kicks the reader back to the top.
      this._updateDom()
    })
  }

  /** Toggles the mobile instructions modal. */
  _toggleInstructions() {
    this._instructionsOpen = !this._instructionsOpen

    this._updateDom()
  }

  /** Closes the mobile instructions modal. */
  _closeInstructions() {
    if (!this._instructionsOpen) return

    this._instructionsOpen = false

    this._updateDom()
  }

  /** Opens the drawer and starts the manifest fetch in one gesture. */

  _toggleNav() {
    this._closeInstructions()

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

    return (
      !q ||
      def.name.toLowerCase().includes(q) ||
      def.id.toLowerCase().includes(q) ||
      (this._names?.byId.get(def.id)?.toLowerCase().includes(q) ?? false)
    )
  }

  /**
   * Selection entry point — shared by nav buttons and canvas picking:
   * loads the dossier panel and flies the camera to the body.
   * @param id Catalog body id.
   */

  _selectBody(id: string) {
    this._closeInstructions()

    // On the mobile layout the nav is a bottom sheet over the scene —
    // leaving it open after a pick hides the body the user just chose.
    if (
      this._navOpen &&
      typeof window !== TYPE_STRINGS.UNDEFINED &&
      window.innerWidth < BREAKPOINTS[768]
    ) {
      this._navOpen = false

      this._updateDom()
    }

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
   * `…/<localized-slug>` (the slugified translated body name once the
   * names table has landed, the raw id before) so Back returns to the
   * chart, closing returns to the base chart URL. Skips when the
   * current route already carries the target so the param-change echo
   * (`onRouteParamChange`) cannot loop.
   * @param id Newly selected body id, or null after close.
   */
  _syncUrl(id: string | null): void {
    const route = router.currentRoute

    if (!route || route.view !== VIEW_TAGS.VIEW_STAR_FIELD) return

    const segment = id ? this._slugForId(id) : null

    if ((route.params?.body ?? null) === segment) return

    const base = this._baseStarPath()

    void router.handleNavigation(segment ? `${base}${CHAR_STRINGS.SLASH}${segment}` : base)
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

    if (body) {
      const resolved = this._resolveBodyParam(body)

      if (resolved) {
        if (this._selectedId !== resolved) this._selectBody(resolved)
      } else if (!this._names) {
        // A localized slug can't resolve before the names table lands —
        // re-try the param once the fetch settles rather than dropping
        // the deep link (engine-ready can outrun a cold names.json).
        void this._namesReady.then(() => {
          const id = this._resolveBodyParam(body)

          if (id && this._selectedId !== id) this._selectBody(id)
        })
      }

      return
    }

    if (!body && this._selectedId) this._closePanel()
  }

  /**
   * Deep-link entry — after the engine reports ready, selects the body
   * named in the URL (flies the camera + opens the dossier). Defaults
   * to the Sun when no specific body was deep-linked.
   */
  _applyDeepLink(): void {
    const body = router.currentRoute?.params?.body

    // Localized slugs resolve only after names.json lands — wait for the
    // in-flight fetch so a deep-linked `…/via-lactea` selects correctly
    // instead of degrading to the Sun while the table is still cold.
    void this._namesReady.then(() => {
      const resolved = body ? this._resolveBodyParam(body) : null

      const target = resolved ?? SF_BODY_IDS.SUN

      if (this._selectedId !== target) this._selectBody(target)
    })
  }

  /** Downloads the current frame as a PNG. */

  _takeScreenshot() {
    this._closeInstructions()

    this._engine?.takeScreenshot()
  }

  /** Returns the camera to the overview pose. */

  _flyHome() {
    this._closeInstructions()

    this._engine?.flyHome()
  }

  /**
   * Hover announce — updates the aria-live HUD text when the pointer
   * crosses a body so screen readers and the HUD chip both learn it.
   * @param id Hovered body id, or null on leaving.
   */

  _handleHover(id: string | null) {
    const text = id ? (this._names?.byId.get(id) ?? _NAME_BY_ID.get(id) ?? '') : ''

    this._syncTip(id, text)

    if (id) {
      // Hover warms the dossier cache (selection then resolves instantly)
      // and upgrades the tooltip to the localized body name on resolve.
      fetchDossier(id).then((file) => {
        const name = file?.name

        // Only upgrade while the hover still reports this body — the
        // live text is the localized name once the names table landed.
        const expected = this._names?.byId.get(id) ?? _NAME_BY_ID.get(id) ?? ''

        if (name && this._liveText === expected) {
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

    // Prefer the localized table once loaded — `_TIP_BY_ID` holds the
    // English catalog name; `text` is the liveText fallback for
    // registry bodies with no catalog entry.
    const name = this._names?.byId.get(id)

    const dist = _DIST_BY_ID.get(id)

    const tipText = name
      ? dist
        ? `${name} ${CHAR_STRINGS.DOT_SEP} ${dist}`
        : name
      : (_TIP_BY_ID.get(id) ?? text)

    if (label) label.textContent = tipText

    tip.style.visibility = ATTR_VALUES.VISIBLE

    tip.removeAttribute(ARIA_ATTRS.ARIA_HIDDEN)
  }

  /**
   * Per-frame hover tracking — the engine reports the hovered body's
   * projected canvas-space pixel position every tick; the tooltip root
   * is translate-positioned so the leader line + label orbit with it.
   * Edge-clamped positions (object off-screen/behind) switch the tip to
   * its `--edge` mode: the marker sits on the canvas rim and the leader
   * line rotates toward the body, so navigator-hover hints locate the
   * object at any zoom level.
   * @param id Hovered body id.
   * @param x Canvas-space x in px.
   * @param y Canvas-space y in px.
   * @param edge True when the projected point was clamped to the rim.
   * @param angle Outward direction in degrees for the leader-line arrow.
   */

  _handleHoverMove(id: string, x: number, y: number, edge?: boolean, angle?: number) {
    const tip = this.$(`.${SF_CLASSES.SF_TIP}`) as HTMLElement | null

    if (!tip) return

    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`

    tip.classList.toggle(SF_CLASSES.SF_TIP_EDGE, !!edge)

    // Flip the label inward — the marker is on the rim, so the label
    // must sit on the canvas side: left of the marker when the object
    // is off to the right, below it when the object is overhead.
    const rad = angle != null ? (angle * Math.PI) / 180 : 0

    if (edge && angle != null) {
      tip.style.setProperty(SF_CSS_PROPS.TIP_ANGLE, `${Math.round(angle)}deg`)
    }

    tip.classList.toggle(SF_CLASSES.SF_TIP_FLIPX, !!edge && Math.cos(rad) > 0)
    tip.classList.toggle(SF_CLASSES.SF_TIP_FLIPY, !!edge && Math.sin(rad) < 0)
  }

  /**
   * Navigator-hover position hint — while a catalog row is hovered or
   * focused the engine reports that body's projected screen position
   * (edge-clamped), so the row's object is located on the canvas at any
   * zoom level before the user commits to the fly-to.
   * @param id Hovered catalog or registry body id.
   * @param rec Registry record — passed only for shard ids (`star-NNNNNN`…).
   */

  _hintBody(id: string, rec?: SFRegistryRecord) {
    this._engine?.setHint(id, rec)
  }

  /** Clears the navigator-hover hint when the row loses pointer/focus. */

  _clearHint() {
    this._engine?.setHint(null)
  }

  /** Announces a selection through the same live region. */

  _announce(id: string) {
    const name = this._names?.byId.get(id) ?? _NAME_BY_ID.get(id) ?? ''

    this._liveText = name

    const live = this.$(`.${SF_CLASSES.SF_LIVE}`)

    if (live) live.textContent = name
  }

  /**
   * Re-renders the component template while preserving three pieces of
   * transient UI state that the wholesale shadow-DOM rebuild would drop:
   * the search input's focus and cursor (autocomplete blur), and the
   * navigator panel's scroll offset — without the carry, any state
   * change (selection, dossier load, manifest arrival) bounces the
   * drawer list back to its top.
   */
  override _updateDom(): void {
    const activeEl = this.shadowRoot?.activeElement as HTMLInputElement | null

    const isSearchFocused = activeEl?.classList?.contains(SF_CLASSES.SF_NAV_SEARCH) ?? false

    const selStart: number | null =
      isSearchFocused && activeEl?.selectionStart != null ? activeEl.selectionStart : null

    const selEnd: number | null =
      isSearchFocused && activeEl?.selectionEnd != null ? activeEl.selectionEnd : null

    const scrollTop = this.$(`.${SF_CLASSES.SF_NAV_PANEL}`)?.scrollTop ?? 0

    super._updateDom()

    if (scrollTop > 0) {
      const panel = this.$(`.${SF_CLASSES.SF_NAV_PANEL}`)

      if (panel) panel.scrollTop = scrollTop
    }

    if (isSearchFocused) {
      const input = this.$(`.${SF_CLASSES.SF_NAV_SEARCH}`) as HTMLInputElement | null

      if (input) {
        input.focus()

        if (selStart !== null && selEnd !== null) {
          input.setSelectionRange(selStart, selEnd)
        }
      }
    }
  }

  override render() {
    return renderStarField(this)
  }
}

if (!customElements.get(VIEW_TAGS.VIEW_STAR_FIELD)) {
  customElements.define(VIEW_TAGS.VIEW_STAR_FIELD, StarField)
}
