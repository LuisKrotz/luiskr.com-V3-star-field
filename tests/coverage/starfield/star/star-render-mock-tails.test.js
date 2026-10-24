/**
 * @file coverage/starfield/star/star-render-mock-tails.test.js
 * @description Coverage tails for star/render.tsx — the catalog-mock arms:
 * an unmapped group key exercises `t[groupKey] || groupKey` and
 * `groups.get(groupKey) ?? []`, plus a dossier whose kind has no label
 * for `t[kind] || kind`. The catalog module is mocked so an order entry
 * can exist without a backing group map entry.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { SF_GROUPS } from '@core/tokens/starfield/kinds.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'

const mockBody = {
  id: 'mock-body',
  name: 'Mock Body',
  kind: 'planet',
  group: SF_GROUPS.SOLAR,
  radius: 1,
  pos: [1, 0, 0],
}
const mockUnmappedKey = 'unmapped-group'

jest.unstable_mockModule('../../../../engine/catalog.js', () => ({
  SF_CATALOG: [mockBody],
  SF_GROUP_ORDER: [SF_GROUPS.SOLAR, mockUnmappedKey],
  sfCatalogByGroup: () => new Map([[SF_GROUPS.SOLAR, [mockBody]]]),
}))

const { renderStarField } = await import('../../../../star/render.js')

const makeHost = (overrides = {}) =>
  Object.assign(
    {
      _dossier: null,
      _dossierLoading: false,
      _liveText: '',
      _navOpen: false,
      _selectedId: null,
      _sfFailed: false,
      _sfReady: false,
      _search: '',
      _matchesSearch: () => true,
      _regManifest: null,
      _regLoaded: new Map(),
      _regRecords: new Map(),
      _regSearch: null,
      _regSearching: false,
      _loadMoreRegistry: jest.fn(),
      translations: null,
      _names: null,
      _musicIndex: 0,
      _musicOpen: false,
      _musicRepeat: false,
      _musicPlaying: false,
      _playMusic: jest.fn(),
      _prevMusic: jest.fn(),
      _nextMusic: jest.fn(),
      _toggleMusicPlay: jest.fn(),
      _toggleMusicRepeat: jest.fn(),
      _toggleMusicList: jest.fn(),
      _instructionsOpen: false,
      _toggleNav: jest.fn(),
      _focusSearch: jest.fn(),
      _toggleInstructions: jest.fn(),
      _selectBody: jest.fn(),
      _closePanel: jest.fn(),
      _takeScreenshot: jest.fn(),
      _flyHome: jest.fn(),
      _baseStarPath: () => ROUTE_PATHS.STAR_FIELD,
      _slugForId: (id) => id,
    },
    overrides
  )

const flatText = (node) => node?.textContent ?? ''

describe('star render tails', () => {
  test('unmapped group keys render the raw key and an empty list', () => {
    const flat = flatText(renderStarField(makeHost()))

    expect(flat).toContain(mockUnmappedKey)
    expect(flat).toContain(mockBody.name)
  })

  test('a dossier with an unlabelled kind falls back to the kind token', () => {
    const flat = flatText(
      renderStarField(
        makeHost({
          _sfReady: true,
          _selectedId: 'mock-body',
          _dossier: {
            name: 'Mock',
            kind: 'oddity',
            tagline: 'x',
            facts: [{ label: 'l', value: 'v' }],
            history: 'h',
            source: 's',
          },
        })
      )
    )

    expect(flat).toContain('oddity')
  })

  test('audio media renders caption/credit figcaption arms', () => {
    const flat = flatText(
      renderStarField(
        makeHost({
          _sfReady: true,
          _selectedId: 'mock-body',
          _dossier: {
            name: 'Mock',
            kind: 'planet',
            tagline: 'x',
            facts: [],
            history: 'h',
            source: 's',
            media: {
              audio: [
                // caption only — `aud.caption || aud.credit` via caption
                { src: 'media/mock/a.ogg', caption: 'Cap' },
                // credit only — the `|| aud.credit` fallback arm +
                // `aud.caption` falsy inside figcaption
                { src: 'media/mock/b.ogg', credit: 'NASA' },
                // neither — falsy figcaption arm
                { src: 'media/mock/c.ogg' },
              ],
            },
          },
        })
      )
    )

    expect(flat).toContain('Cap')
    expect(flat).toContain('NASA')

    // Images-only media — the `m.audio ?? []` empty-fallback arm.
    const noAudio = flatText(
      renderStarField(
        makeHost({
          _sfReady: true,
          _selectedId: 'mock-body',
          _dossier: {
            name: 'Mock',
            kind: 'planet',
            tagline: 'x',
            facts: [],
            history: 'h',
            source: 's',
            media: { images: [{ src: 'media/mock/pic.jpg', caption: 'Pic' }] },
          },
        })
      )
    )

    expect(noAudio).toContain('Pic')
  })

  test('a dossier without facts renders the defensive empty list', () => {
    const flat = flatText(
      renderStarField(
        makeHost({
          _sfReady: true,
          _sfFailed: true,
          _navOpen: true,
          _dossierLoading: true,
          translations: { hint: 'hinted' },
          _dossier: {
            name: 'Mock',
            kind: 'planet',
            tagline: 'x',
            history: 'h',
            source: 's',
          },
        })
      )
    )

    expect(flat).toContain('hinted')
  })
})
