/**
 * @file engine/bodies/belt.ts
 * @description Small-body annulus renderer — asteroid belt and Kuiper
 * belt entries draw as a seeded Points disc between `belt.inner` and
 * `belt.outer` chart units:
 *
 *   radial layout   — sqrt-uniform area weighting so particle density is
 *                     even per unit of annulus area (uniform r would
 *                     over-pack the inner edge)
 *   Kirkwood lanes  — optional density modulation `sin(r·GAP_FREQ)`
 *                     rejects a fraction of samples inside resonance
 *                     lanes, carving the gaps Jupiter clears in the
 *                     real belt; a def-level `gapFreq: 0` renders a
 *                     smooth classical disc (the Kuiper belt)
 *   inclination     — a thin vertical gaussian (`puff` fraction of the
 *                     annulus width) gives the disc real thickness —
 *                     Kuiper is puffier than the asteroid belt
 *   albedo mix      — per-particle brightness jitter around `def.color`
 *                     so the annulus reads as mixed C-type/S-type rubble
 *                     (or varied ices) instead of a dotted hairline
 *
 * The Points object is never raycast-pickable — its thousands of
 * pebbles would intercept every pointer ray; the navigator still flies
 * to the node's anchor for the dossier.
 */
import type * as THREE_NS from 'three'
import { SF_BELT, SF_COLORS, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { WASM_ACTIONS, fillField } from '../fill-worker.js'
import { lcg, seedFrom } from '../rand.js'
import { matParams } from '../materials.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

/**
 * Fills one index range of the belt annulus — each candidate index owns
 * a Fibonacci-hashed LCG stream so the fill partitions across the worker
 * pool; Kirkwood-lane rejects compact out of the range's live count.
 * Returns the number of points actually placed (≤ range length).
 * @param pos xyz buffer — compacted output from index 0.
 * @param col rgb buffer (same).
 * @param seed Body seed.
 * @param count Candidate count for this range.
 * @param inner Annulus inner edge (chart units).
 * @param width Annulus width.
 * @param puff Vertical gaussian half-thickness.
 * @param lanes Kirkwood gap frequency (0 = smooth classical disc).
 * @param tint RGB particle tint.
 * @param i0 First candidate index (0 for the local fill).
 * @param i1 One past the last candidate index.
 * @returns Live point count written.
 */
function fillBeltRange(
  pos: Float32Array,
  col: Float32Array,
  seed: number,
  count: number,
  inner: number,
  width: number,
  puff: number,
  lanes: number,
  tint: [number, number, number],
  i0 = 0,
  i1 = count
): number {
  let kept = 0

  for (let i = i0; i < i1; i++) {
    const rand = lcg((seed ^ Math.imul(i + 1, SF_SPIRAL.SEED_STEP)) >>> 0)

    const r = inner + Math.sqrt(rand()) * width

    const angle = rand() * Math.PI * 2

    const lane = Math.sin(r * lanes)

    if (lanes > 0 && rand() > 1 - SF_BELT.GAP_DEPTH * lane * lane) continue

    const o = kept * 3

    pos[o] = Math.cos(angle) * r
    pos[o + 1] = (rand() + rand() - 1) * puff
    pos[o + 2] = Math.sin(angle) * r

    const albedo = 1 - SF_BELT.ALBEDO_JITTER / 2 + rand() * SF_BELT.ALBEDO_JITTER

    col[o] = tint[0] * albedo
    col[o + 1] = tint[1] * albedo
    col[o + 2] = tint[2] * albedo

    kept++
  }

  return kept
}

/**
 * Builds the seeded particle annulus for a `kind: belt` catalog entry —
 * the asteroid belt between Mars and Jupiter, the Kuiper belt beyond
 * Neptune. Returns the Points object that becomes the node's mesh; its
 * `raycast` is a no-op by contract (non-pickable detail).
 * @param THREE The three.js module.
 * @param def Catalog entry — `def.belt` carries inner/outer/count/puff,
 *   `def.color` tints the particles, `def.id` seeds the LCG.
 * @param glowTex Shared soft-disc sprite texture (may be undefined).
 */
export function makeBelt(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): THREE_NS.Points {
  const belt = def.belt

  const count = belt?.count ?? 0

  const inner = belt?.inner ?? 0

  const outer = belt?.outer ?? 0

  const width = Math.max(outer - inner, 1)

  const puff = (belt?.puff ?? SF_BELT.PUFF) * width

  const lanes = belt?.gapFreq ?? SF_BELT.GAP_FREQ

  const seed = seedFrom(def.id)

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  const tintC = new THREE.Color(def.color ?? SF_COLORS.CERES)

  const tint: [number, number, number] = [tintC.r, tintC.g, tintC.b]

  const geo = new THREE.BufferGeometry()

  const mat = new THREE.PointsMaterial(
    matParams({
      size: SF_BELT.PX,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: SF_BELT.OPACITY,
      depthWrite: false,
      sizeAttenuation: true,
    })
  )

  const points = new THREE.Points(geo, mat)

  points.raycast = () => undefined

  // Candidate-budget fill — Kirkwood rejects thin the count where
  // sin²(r·freq) dips under the draw. Chunked through the WASM worker
  // pool; the local fillBeltRange is the bit-identical fallback.
  const apply = (p: Float32Array, c: Float32Array, kept: number) => {
    geo.setAttribute('position', new THREE.BufferAttribute(p.slice(0, kept * 3), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(c.slice(0, kept * 3), 3))
    // Empty uv — the node-material pipeline samples `uv` when a `map` is
    // set even though points shade via gl_PointCoord; declaring it keeps
    // the shader graph quiet.
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(kept * 2), 2))
  }

  fillField(
    WASM_ACTIONS.SF_FILL_BELT,
    {
      seed,
      count,
      inner,
      width,
      puff,
      lanes,
      tint,
      p: { ...SF_BELT, SEED_STEP: SF_SPIRAL.SEED_STEP },
    },
    count,
    false
  ).then((res) => {
    if (res) {
      apply(res.pos, res.col, res.kept)
    } else {
      apply(pos, col, fillBeltRange(pos, col, seed, count, inner, width, puff, lanes, tint))
    }
  })

  return points
}
