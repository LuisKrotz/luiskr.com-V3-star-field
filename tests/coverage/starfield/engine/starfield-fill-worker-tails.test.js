/**
 * @file coverage/starfield/engine/starfield-fill-worker-tails.test.js
 * @description Coverage tails for `fillField` — the chunked multi-worker
 * fill dispatcher. `wasmPool.dispatch` is mocked per-test so every reply
 * arm is reachable deterministically: empty counts, single vs chunked
 * splits, null/malformed replies voiding the whole fill, fixed-length
 * validation, and the compacted `kept` merge.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals'

jest.unstable_mockModule('@core/utils/wasm/wasm-pool.js', () => ({
  wasmPool: { dispatch: jest.fn() },
}))

const { fillField } = await import('../../../../engine/fill-worker.js')
const { wasmPool } = await import('@core/utils/wasm/wasm-pool.js')

const dispatch = wasmPool.dispatch

/**
 * Builds a flat fill reply (`results.pos`/`results.col` triplets).
 * @param n Point count.
 * @param asArray When true returns plain arrays (the ArrayLike arm).
 */
const reply = (n, asArray = false) => {
  const pos = new Float32Array(n * 3).fill(0.5)
  const col = new Float32Array(n * 3).fill(0.25)

  return { results: { pos: asArray ? [...pos] : pos, col: asArray ? [...col] : col } }
}

describe('fillField dispatcher tails', () => {
  beforeEach(() => dispatch.mockReset())

  test('returns null immediately for an empty count', async () => {
    expect(await fillField('action', {}, 0, true)).toBeNull()
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('small fills dispatch one chunk; replies merge into typed buffers', async () => {
    dispatch.mockResolvedValueOnce(reply(2))

    const res = await fillField('action', { seed: 1 }, 2, true)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('action', { seed: 1, i0: 0, i1: 2 })
    expect(res.kept).toBe(2)
    expect(res.pos).toBeInstanceOf(Float32Array)
    expect(res.pos.length).toBe(6)
  })

  test('large fills split across MAX_CHUNKS-parallel range jobs', async () => {
    // 400 000 points → ceil(400k/40k)=10, capped at 4 chunks of 100k.
    dispatch.mockImplementation(() => Promise.resolve(reply(100000)))

    const res = await fillField('action', {}, 400000, true)

    expect(dispatch).toHaveBeenCalledTimes(4)
    expect(dispatch).toHaveBeenNthCalledWith(4, 'action', { i0: 300000, i1: 400000 })
    expect(res.kept).toBe(400000)
  })

  test('a mid-size fill splits by CHUNK_MIN, not MAX_CHUNKS', async () => {
    // 90 000 → ceil(90k/40k)=3 chunks of 30k.
    dispatch.mockImplementation(() => Promise.resolve(reply(30000)))

    const res = await fillField('action', {}, 90000, true)

    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(res.kept).toBe(90000)
  })

  test('a null chunk reply voids the whole fill', async () => {
    dispatch.mockResolvedValueOnce(null)

    expect(await fillField('action', {}, 2, true)).toBeNull()
  })

  test('a reply missing pos or col voids the fill', async () => {
    dispatch.mockResolvedValueOnce({ results: { pos: new Float32Array(6) } })
    expect(await fillField('action', {}, 2, true)).toBeNull()

    dispatch.mockResolvedValueOnce({ results: { col: new Float32Array(6) } })
    expect(await fillField('action', {}, 2, true)).toBeNull()
  })

  test('fixed-length fills reject a short chunk', async () => {
    dispatch.mockResolvedValueOnce(reply(1))

    expect(await fillField('action', {}, 2, true)).toBeNull()
  })

  test('variable fills compact to the shortest channel and report kept', async () => {
    // Belt-style rejection fill: pos returned 2 records, col only 1 —
    // the live count follows the shorter buffer.
    dispatch.mockResolvedValueOnce({
      results: { pos: new Float32Array(6).fill(1), col: new Float32Array(3).fill(0.5) },
    })

    const res = await fillField('action', {}, 2, false)

    expect(res.kept).toBe(1)
    expect(res.pos.length).toBe(3)
  })

  test('plain-array replies convert to Float32Array', async () => {
    dispatch.mockResolvedValueOnce(reply(2, true))

    const res = await fillField('action', {}, 2, true)

    expect(res.pos).toBeInstanceOf(Float32Array)
    expect(res.kept).toBe(2)
  })
})
