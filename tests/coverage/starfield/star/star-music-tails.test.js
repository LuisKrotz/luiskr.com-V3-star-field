/**
 * @file coverage/starfield/star/star-music-tails.test.js
 * @description Coverage tails for star/music.ts — the persistent <audio>
 * element (create-once + reuse), card (re)mount and localized aria-label
 * fallbacks, track pick (invalid index, src change/reuse, play rejection),
 * `ended` auto-advance wrapping, and the reduced-motion autoplay gate.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { SF_CLASSES } from '@core/tokens/classes/starfield.js'
import { SF_MUSIC_TRACKS } from '@core/tokens/starfield/music.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import store from '@core/store.js'

import {
  autoplayMusic,
  getMusicEl,
  mountMusic,
  nextMusic,
  playMusic,
} from '../../../../star/music.js'

const makeHost = (overrides = {}) => ({
  _musicIndex: 0,
  _musicEl: null,
  translations: null,
  $: () => null,
  _updateDom: jest.fn(),
  ...overrides,
})

const mountableHost = (overrides = {}) => {
  const card = document.createElement('div')
  card.className = SF_CLASSES.SF_MUSIC
  const host = makeHost({ $: () => card, ...overrides })
  return { host, card }
}

describe('getMusicEl', () => {
  test('creates the persistent player once and reuses it', () => {
    const host = makeHost({ _musicIndex: 1 })

    const el = getMusicEl(host)
    const again = getMusicEl(host)

    expect(again).toBe(el)
    expect(el.className).toBe(SF_CLASSES.SF_MUSIC_AUDIO)
    expect(el.controls).toBe(true)
    expect(el.getAttribute('src')).toBe(SF_MUSIC_TRACKS[1].src)
  })

  test('starts without a src when the index has no track', () => {
    const host = makeHost({ _musicIndex: 99 })

    const el = getMusicEl(host)

    expect(el.getAttribute('src')).toBe('')
  })
})

describe('mountMusic', () => {
  test('returns early when the card is absent', () => {
    const host = makeHost()

    mountMusic(host)

    expect(host._musicEl).toBeNull()
  })

  test('appends the player, re-seats an existing one, and localizes the label', () => {
    const { host, card } = mountableHost({
      translations: { music: 'Musique d’ambiance' },
    })

    mountMusic(host)
    const el = host._musicEl

    expect(card.contains(el)).toBe(true)
    expect(el.getAttribute(ARIA_ATTRS.ARIA_LABEL)).toBe('Musique d’ambiance')

    // A second mount over an already-seated element keeps it in place and
    // re-syncs the label without duplicating the node.
    host.translations = null
    mountMusic(host)

    expect(card.childElementCount).toBe(1)
    expect(el.getAttribute(ARIA_ATTRS.ARIA_LABEL)).toBeTruthy()
  })
})

describe('playMusic', () => {
  test('ignores an out-of-range index', () => {
    const host = makeHost()

    playMusic(host, 99)

    expect(host._musicEl).toBeNull()
    expect(host._updateDom).not.toHaveBeenCalled()
  })

  test('retargets src on a new track and resumes on a repeated pick', () => {
    const host = makeHost()
    const el = getMusicEl(host)
    const play = jest.fn().mockResolvedValue(undefined)
    el.play = play

    // Index 0 is already loaded — the same-track arm resumes without
    // retargeting src.
    playMusic(host, 0)

    playMusic(host, 1)

    expect(el.getAttribute('src')).toBe(SF_MUSIC_TRACKS[1].src)
    expect(play).toHaveBeenCalledTimes(2)
    expect(host._musicIndex).toBe(1)
    expect(host._updateDom).toHaveBeenCalledTimes(2)
  })
})

describe('nextMusic', () => {
  test('wraps the playlist back to the first track', () => {
    const host = makeHost({ _musicIndex: SF_MUSIC_TRACKS.length - 1 })
    const el = getMusicEl(host)
    el.play = jest.fn().mockResolvedValue(undefined)

    nextMusic(host)

    expect(host._musicIndex).toBe(0)
    expect(el.getAttribute('src')).toBe(SF_MUSIC_TRACKS[0].src)
  })

  test('the ended listener auto-advances the playlist', () => {
    const host = makeHost()
    const el = getMusicEl(host)
    el.play = jest.fn().mockResolvedValue(undefined)

    el.dispatchEvent(new Event('ended'))

    expect(host._musicIndex).toBe(1)
  })
})

describe('playback rejection', () => {
  test('a rejected play() leaves the controls available (pick + autoplay)', async () => {
    const host = makeHost()
    const el = getMusicEl(host)
    el.play = jest.fn().mockRejectedValue(new Error('autoplay blocked'))

    playMusic(host, 0)

    const motion = jest.spyOn(store.getters, 'getReducedMotion').mockReturnValue(false)

    autoplayMusic(host)

    // Flush the rejected promises — both .catch(() => {}) handlers absorb.
    await Promise.resolve()
    await Promise.resolve()

    motion.mockRestore()
    expect(host._musicIndex).toBe(0)
    expect(el.play).toHaveBeenCalledTimes(2)
  })
})

describe('autoplayMusic', () => {
  test('stays silent under reduced motion and plays otherwise', () => {
    const motion = jest.spyOn(store.getters, 'getReducedMotion').mockReturnValue(true)
    const host = makeHost()

    autoplayMusic(host)

    expect(host._musicEl).toBeNull()

    motion.mockReturnValue(false)
    const el = getMusicEl(host)
    const play = jest.fn().mockResolvedValue(undefined)
    el.play = play

    autoplayMusic(host)

    expect(play).toHaveBeenCalled()

    motion.mockRestore()
  })
})
