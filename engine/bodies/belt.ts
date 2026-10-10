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
import { SF_BELT, SF_COLORS } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../rand.js'
import { matParams } from '../materials.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

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

  const rand = lcg(seedFrom(def.id))

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  const tint = new THREE.Color(def.color ?? SF_COLORS.CERES)

  let placed = 0

  // Rejection-sample until the particle budget fills — gap lanes thin
  // the count where sin²(r·freq) dips under the draw.
  while (placed < count) {
    const r = inner + Math.sqrt(rand()) * width

    const angle = rand() * Math.PI * 2

    const lane = Math.sin(r * lanes)

    if (lanes > 0 && rand() > 1 - SF_BELT.GAP_DEPTH * lane * lane) continue

    const i = placed * 3

    pos[i] = Math.cos(angle) * r
    pos[i + 1] = (rand() + rand() - 1) * puff
    pos[i + 2] = Math.sin(angle) * r

    const albedo = 1 - SF_BELT.ALBEDO_JITTER / 2 + rand() * SF_BELT.ALBEDO_JITTER

    col[i] = tint.r * albedo
    col[i + 1] = tint.g * albedo
    col[i + 2] = tint.b * albedo

    placed++
  }

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  // Empty uv — the node-material pipeline samples `uv` when a `map` is
  // set even though points shade via gl_PointCoord; declaring it keeps
  // the shader graph quiet.
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(placed * 2), 2))

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

  return points
}
