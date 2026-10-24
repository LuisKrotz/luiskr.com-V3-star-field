/**
 * @file star/music.ts
 * @description Ambient playlist player for the star-field view — one
 * persistent <audio> element (same contract as the render canvas: the
 * element outlives the per-render DOM rebuild so playback position and
 * state survive every _updateDom triggered by selections, searches and
 * hints) plus the track-list and transport-row interactions. `ended`
 * auto-advances through the playlist and wraps to the first track, so
 * the soundtrack runs continuously once started; the repeat toggle
 * switches that advance for a single-track loop via the element's
 * `loop` flag. Autoplay is attempted on mount unless the
 * reduced-motion preference suppresses it — the sanctioned
 * screen-reader proxy, same contract as the earth playground player.
 */
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { MEDIA_EVENTS } from '@core/tokens/events/dom.js'
import { MEDIA_ATTRS } from '@core/tokens/attrs/media.js'
import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { SF_MUSIC_TRACKS } from '@core/tokens/starfield/music.js'
import { TRANSLATION_KEYS } from '@core/tokens/routes/translation-keys.js'
import { FALLBACK_PAGES } from '@core/locale/fallback.js'
import store from '@core/store.js'
import type { StarField } from '../StarField.js'

/** English snapshot for the pages/star-field node — pre-fetch labels. */
const SF_DEFAULTS = FALLBACK_PAGES[TRANSLATION_KEYS.STAR_FIELD] as Record<string, unknown>

/**
 * Mirrors the live transport state into host fields and repaints the
 * controls row — bound once to the persistent element's play/pause
 * events so both the custom buttons and the native controls stay in
 * sync however playback changes.
 * @param host The StarField component.
 * @param playing Whether playback just started (play) or stopped (pause).
 */
const syncPlaying = (host: StarField, playing: boolean): void => {
  host._musicPlaying = playing

  host._updateDom()
}

/**
 * The persistent playlist element — created once with the native
 * controls (play/seek/volume stay the browser's accessible interface),
 * the `nodownload` controls list, the `ended` auto-advance binding and
 * the play/pause state mirrors that keep the transport row's icons
 * truthful. Re-inserted by mountMusic() after every render rebuild
 * because the .sf-music card is JSX and gets replaced wholesale.
 * @param host The StarField component.
 * @returns The shared <audio> element bound to the playlist.
 */
export function getMusicEl(host: StarField): HTMLAudioElement {
  if (!host._musicEl) {
    const el = document.createElement(HTML_TAGS.AUDIO)

    el.className = SF_CLASSES.SF_MUSIC_AUDIO
    el.controls = true
    el.setAttribute(MEDIA_ATTRS.CONTROLS_LIST, MEDIA_ATTRS.NO_DOWNLOAD)
    el.preload = ATTR_VALUES.NONE
    el.loop = host._musicRepeat
    el.src = SF_MUSIC_TRACKS[host._musicIndex]?.src ?? ATTR_VALUES.EMPTY

    el.addEventListener(MEDIA_EVENTS.ENDED, () => nextMusic(host))
    el.addEventListener(MEDIA_EVENTS.PLAY, () => syncPlaying(host, true))
    el.addEventListener(MEDIA_EVENTS.PAUSE, () => syncPlaying(host, false))

    host._musicEl = el
  }

  return host._musicEl
}

/**
 * (Re)mounts the player inside the freshly rendered .sf-music card and
 * re-syncs the translated aria-label — called from onMounted and every
 * onUpdated so a locale swap re-labels the live element.
 * @param host The StarField component.
 */
export function mountMusic(host: StarField): void {
  const card = host.$(`.${SF_CLASSES.SF_MUSIC}`)

  if (!card) return

  const el = getMusicEl(host)

  if (!card.contains(el)) card.appendChild(el)

  el.setAttribute(
    ARIA_ATTRS.ARIA_LABEL,
    String(
      host.translations?.music ??
        SF_DEFAULTS?.music ??
        /* istanbul ignore next -- defensive: the bundled English snapshot always carries pages.star-field.music */
        ATTR_VALUES.EMPTY
    )
  )
}

/**
 * Selects and plays a playlist track — retargets src only when it
 * actually changed (a re-tap on the loaded track just resumes), then
 * re-renders so the list repaints its active row. Playback rejection
 * (autoplay policy before a user gesture) is swallowed — the native
 * controls stay available to press play.
 * @param host The StarField component.
 * @param index Track index into SF_MUSIC_TRACKS.
 */
export function playMusic(host: StarField, index: number): void {
  const track = SF_MUSIC_TRACKS[index]

  if (!track) return

  host._musicIndex = index

  const el = getMusicEl(host)

  if (el.getAttribute(MEDIA_ATTRS.SRC) !== track.src) el.src = track.src

  el.play().catch(() => {})

  host._updateDom()
}

/**
 * Advances to the next playlist track, wrapping to the first after the
 * last — bound once to the element's `ended` event so the playlist
 * chains without extra wiring, and reused by the next transport button.
 * @param host The StarField component.
 */
export function nextMusic(host: StarField): void {
  playMusic(host, (host._musicIndex + 1) % SF_MUSIC_TRACKS.length)
}

/**
 * Steps back one playlist track, wrapping to the last from the first —
 * the previous transport button's handler.
 * @param host The StarField component.
 */
export function prevMusic(host: StarField): void {
  playMusic(host, (host._musicIndex - 1 + SF_MUSIC_TRACKS.length) % SF_MUSIC_TRACKS.length)
}

/**
 * Play/pause toggle for the transport row — starts the current track
 * when paused (same swallowed autoplay rejection as playMusic) and
 * pauses when playing. The play/pause event listeners own the state
 * repaint, so this only drives the element.
 * @param host The StarField component.
 */
export function toggleMusicPlay(host: StarField): void {
  const el = getMusicEl(host)

  if (el.paused) {
    el.play().catch(() => {})
  } else {
    el.pause()
  }
}

/**
 * Repeat toggle — flips the host flag and the element's `loop`
 * attribute: engaged, the current track replays in place and `ended`
 * never fires; disengaged, the playlist auto-advance returns.
 * @param host The StarField component.
 */
export function toggleMusicRepeat(host: StarField): void {
  host._musicRepeat = !host._musicRepeat

  const el = getMusicEl(host)

  el.loop = host._musicRepeat

  host._updateDom()
}

/**
 * Mount-time autoplay — skipped under prefers-reduced-motion (the
 * screen-reader proxy) so AT sessions start silent; anyone can still
 * press play. The rejection is swallowed for the same autoplay-policy
 * reason as playMusic.
 * @param host The StarField component.
 */
export function autoplayMusic(host: StarField): void {
  if (store.getters.getReducedMotion?.()) return

  getMusicEl(host)
    .play()
    .catch(() => {})
}
