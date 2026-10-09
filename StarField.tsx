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
import { SF_KEYS } from '@core/tokens/starfield/params.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
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
    .map((def): [string, string] => [
      def.id,
      def.dist ? `${def.name} ${CHAR_STRINGS.DOT_SEP} ${def.dist}` : def.name,
    ])
)

/** Pre-built id → distance-label lookup for tooltip upgrades. */
const _DIST_BY_ID = new Map(
  [...sfCatalogByGroup().values()]
    .flat()
    .map((def): [string, string] => [def.id, def.dist ?? CHAR_STRINGS.EMPTY])
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
  _navOpen = false // navigator drawer open state
  _selectedId: string | null = null // dossier panel body id
  _dossier: SFDossier | null = null // locale dossier for the panel
  _dossierLoading = false // dossier fetch in flight — panel shows loading
  _liveText = '' // aria-live announcements (hover/selection names)
  _lastLocale: string | null = null // locale the labels were last fetched for
  translations: Record<string, unknown> | null = null // pages/star-field label node
  _onKeyDown: ((e: Event) => void) | null = null // Escape + arrow-keys handler

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

  /** Toggles the navigator drawer open/closed. */

  _toggleNav() {
    this._navOpen = !this._navOpen

    this._updateDom()
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
  }

  /** Closes the dossier panel and clears the selection. */

  _closePanel() {
    this._selectedId = null

    this._dossier = null

    this._dossierLoading = false

    this._updateDom()
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
