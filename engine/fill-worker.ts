/**
 * @file engine/fill-worker.ts
 * @description Multi-threaded fill dispatcher — the star-field's heavy
 * seeded buffer math (spiral-disc points, elliptical dwarfs, dust lanes,
 * deep-field decode, speckle clouds, belt annuli) is batch CPU work, so
 * per the project's compute-placement rule it routes through the shared
 * `wasmPool` worker pool instead of blocking the render thread:
 *
 *   - Every fill is partitioned by index range and dispatched as
 *     parallel chunk jobs across the pool — a 400k-point galaxy fills
 *     on up to four workers simultaneously.
 *   - Determinism is preserved bit-for-bit: per-point RNG streams are
 *     seeded by absolute index (`seed ^ i·SEED_STEP`, the Fibonacci
 *     hash), so a chunk computed on worker 3 equals the same range
 *     computed by the local fallback.
 *   - Every dispatch degrades to `null` → the caller runs the identical
 *     local fill, so SSR/headless/no-Worker environments render the
 *     same scene a frame later.
 */
import { wasmPool } from '@core/utils/wasm/wasm-pool.js'
import { WASM_ACTIONS } from '@core/tokens/data/wasm.js'
import { SF_WORKER } from '@core/tokens/starfield/params.js'

/**
 * Merged fill result — flat interleaved buffers the caller writes into
 * geometry attributes (`pos` xyz triplets, `col` rgb triplets). Chunks
 * that compact variable-length output (belt rejection sampling, the
 * deep-field sentinel drop) return `kept` — the merged buffers are
 * sliced to the true point count by the caller via `count`.
 */
export interface SFFill {
  pos: Float32Array
  col: Float32Array
  /** Live vertex count after in-chunk compaction (≤ requested count). */
  kept: number
}

/** Worker reply envelope shape — results carry typed arrays (transferred). */
interface FillReply {
  results?: {
    pos?: ArrayLike<number>
    col?: ArrayLike<number>
    kept?: number
  }
}

/**
 * Dispatches one buffer fill to the worker pool, chunked by index range
 * for true multi-threading. `base` carries the job's constant payload —
 * seed, geometry params and the p-token map the worker mirrors — plus
 * `count` records split into ≤MAX_CHUNKS equal ranges. Replies merge in
 * order into one pair of typed arrays; any failed chunk (null reply,
 * malformed length) voids the whole result so the caller falls back to
 * the identical local fill rather than mixing partial buffers.
 * @param action WASM_ACTIONS message type the worker dispatches on.
 * @param base Constant job payload shared by every chunk.
 * @param count Total record count to fill across chunks.
 * @param fixedLen When true every chunk must return exactly its range
 *   length (spiral/elliptical fills); false allows compacted results
 *   (belt/deep-field).
 * @returns Merged fill buffers, or null on any failure → JS fallback.
 */
export async function fillField(
  action: string,
  base: Record<string, unknown>,
  count: number,
  fixedLen: boolean
): Promise<SFFill | null> {
  if (count <= 0) return null

  const chunks =
    count >= SF_WORKER.CHUNK_MIN
      ? Math.min(SF_WORKER.MAX_CHUNKS, Math.ceil(count / SF_WORKER.CHUNK_MIN))
      : 1

  const step = Math.ceil(count / chunks)

  const jobs: Promise<unknown>[] = []

  for (let c = 0; c < chunks; c++) {
    const i0 = c * step
    const i1 = Math.min(count, i0 + step)

    jobs.push(wasmPool.dispatch(action, { ...base, i0, i1 }))
  }

  const res = (await Promise.all(jobs)) as (FillReply | null)[]

  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)

  let kept = 0

  for (let c = 0; c < chunks; c++) {
    const r = res[c]?.results

    if (!r?.pos || !r.col) return null

    const cpos = r.pos instanceof Float32Array ? r.pos : new Float32Array(r.pos)
    const ccol = r.col instanceof Float32Array ? r.col : new Float32Array(r.col)
    const expected = (Math.min(count, (c + 1) * step) - c * step) * 3

    if (fixedLen && cpos.length !== expected) return null

    const live = Math.floor(Math.min(cpos.length, ccol.length) / 3)

    pos.set(cpos.subarray(0, live * 3), kept * 3)
    col.set(ccol.subarray(0, live * 3), kept * 3)

    kept += live
  }

  return { pos: pos.slice(0, kept * 3), col: col.slice(0, kept * 3), kept }
}

export { WASM_ACTIONS }
