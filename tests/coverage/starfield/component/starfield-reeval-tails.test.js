/**
 * @file coverage/starfield/component/starfield-reeval-tails.test.js
 * @description Coverage tail for StarField.tsx module evaluation — the
 * `customElements.get(...)` guard's else arm. The tag is pre-registered
 * with a stand-in class so the module's define guard skips redefinition
 * (the same protection a hot-reload path would take).
 */
import { describe, test, expect, jest } from '@jest/globals'

import { VIEW_TAGS } from '@core/tokens/elements/views.js'

class StandInStarField extends window.HTMLElement {}

window.customElements.define(VIEW_TAGS.VIEW_STAR_FIELD, StandInStarField)

const { StarField } = await import('../../../../StarField.js')

describe('StarField module re-evaluation', () => {
  test('a pre-registered tag keeps its original constructor', () => {
    expect(window.customElements.get(VIEW_TAGS.VIEW_STAR_FIELD)).toBe(StandInStarField)
  })

  test('_loadMoreRegistry takes the fetch arm while shard bounds allow', async () => {
    // This file is the reset-free, mock-free import — its module instance
    // is the instrumented one istanbul serializes, so hits here survive
    // the merge (mocked-import siblings discard theirs).
    const fetchStub = jest.fn(async () => ({
      ok: true,
      json: async () => [
        { i: 'star-000000', n: 'Sirius', m: -1.4, d: 8.6, s: 'A1V', x: 1, y: 2, z: 3 },
      ],
    }))

    globalThis.fetch = fetchStub

    // Two declared shards with zero loaded — loaded < shards must fall
    // through to the shard fetch instead of early-returning.
    const stub = {
      _regLoaded: new Map(),
      _regManifest: { kinds: { star: { shards: ['star-000.json', 'star-001.json'] } } },
      _regRecords: new Map(),
      _updateDom: () => {},
    }

    StarField.prototype._loadMoreRegistry.call(stub, 'star')

    expect(stub._regLoaded.get('star')).toBe(1)

    await new Promise((r) => setTimeout(r, 30))

    expect((stub._regRecords.get('star') ?? []).length).toBe(1)
  })
})
