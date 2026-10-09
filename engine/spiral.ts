/**
 * @file engine/spiral.ts
 * @description Procedural spiral-galaxy generator — a Gaia-style star
 * distribution rendered as one THREE.Points draw call: ~60k vertices
 * spread over logarithmic spiral arms plus a warm central bulge, with a
 * per-vertex warm-core → cool-edge color ramp. A bright core sprite and
 * an invisible pick sphere ride in the same group so raycasts/hover
 * resolve the galaxy without touching the point cloud.
 *
 * The distribution is deterministic (seeded LCG) so every boot draws the
 * same galaxy — no flicker between visits, no per-frame allocation.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import type { SFBodyDef } from './types.js'

type ThreeModule = typeof import('three')

/**
 * Deterministic linear congruential generator — same seed → same star
 * field every session (avoids Math.random so renders are reproducible).
 * @param seed Arbitrary seed derived from the body id hash.
 * @returns () => float in [0,1).
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 4294967296
  }
}

/**
 * Seeds the LCG from a string — stable per body id so Milky Way and
 * Andromeda share the generator but scatter differently.
 * @param id Body id string.
 */
function seedFrom(id: string): number {
  let h = 2166136261

  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  }

  return h
}

/**
 * Fills the position + color buffers for one spiral galaxy: `BULGE`
 * fraction of points cluster in the core (tight gaussian), the rest
 * follow `ARMS` logarithmic arms with angular jitter and a thin vertical
 * gaussian so the disc reads as a real spiral at any tilt.
 * @param pos Float32 xyz buffer (COUNT×3).
 * @param col Float32 rgb buffer (COUNT×3).
 * @param radius Disc radius in scene units.
 * @param rand Seeded LCG.
 */
function fillSpiral(
  pos: Float32Array,
  col: Float32Array,
  radius: number,
  rand: () => number,
  count: number,
  arms: number
): void {
  const bulgeCount = Math.floor(count * SF_SPIRAL.BULGE)

  for (let i = 0; i < count; i++) {
    const inBulge = i < bulgeCount

    // Radial distance — bulge is tight gaussian; arms spread sqrt-uniform.
    const r = inBulge ? Math.abs(rand() + rand() - 1) * radius * 0.16 : Math.sqrt(rand()) * radius

    // Arm phase — log-spiral wind + even arm offset + scatter jitter.
    const arm = i % arms

    const base = (r / radius) * SF_SPIRAL.WIND + (arm * Math.PI * 2) / arms

    const angle = inBulge ? rand() * Math.PI * 2 : base + (rand() - 0.5) * 0.42

    const y = (rand() + rand() - 1) * radius * SF_SPIRAL.THIN * (inBulge ? 3.2 : 1)

    pos[i * 3] = Math.cos(angle) * r
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = Math.sin(angle) * r

    // Warm core → cool edge ramp; bulge stays near-core tint.
    const k = inBulge ? 0.22 : r / radius

    col[i * 3] = SF_SPIRAL.CORE_R + (SF_SPIRAL.EDGE_R - SF_SPIRAL.CORE_R) * k
    col[i * 3 + 1] = SF_SPIRAL.CORE_G + (SF_SPIRAL.EDGE_G - SF_SPIRAL.CORE_G) * k
    col[i * 3 + 2] = SF_SPIRAL.CORE_B + (SF_SPIRAL.EDGE_B - SF_SPIRAL.CORE_B) * k
  }
}

/**
 * Builds a spiral galaxy node: tilted group containing the 60k-point
 * spiral disc, a small additive core sprite for the bulge glow, and an
 * invisible sphere that carries `userData.bodyId` so picking/hover work
 * against a real mesh instead of raycasting 60k points.
 * @param THREE The three.js module.
 * @param def Catalog galaxy entry (radius = disc radius, tilt = disc tilt,
 * `spiralDisc.count` = particle target standing in for the true stellar
 * population — Milky Way asks for 1M, Andromeda 800k, dwarf satellites
 * less; the value is capped by `COUNT_MAX` and quartered on mobile).
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 * @param mobile Whether to apply the mobile divisor (small viewport).
 * @returns `{ group, pick }` — the spin target and the pickable mesh.
 */
export function makeSpiralGalaxy(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined,
  mobile = false
): { group: THREE_NS.Object3D; pick: THREE_NS.Object3D } {
  const group = new THREE.Group()

  const asked = Math.min(def.spiralDisc?.count ?? SF_SPIRAL.COUNT, SF_SPIRAL.COUNT_MAX)

  const count = mobile ? Math.max(1, Math.floor(asked / SF_SPIRAL.MOBILE_DIVISOR)) : asked

  const arms = def.spiralDisc?.arms ?? SF_SPIRAL.ARMS

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  fillSpiral(pos, col, def.radius, lcg(seedFrom(def.id)), count, arms)

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const mat = new THREE.PointsMaterial({
    size: SF_SPIRAL.POINT_PX,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geo, mat)

  // Keep raycasts off the 60k-point cloud — the pick sphere handles hover.
  points.raycast = () => undefined

  group.add(points)

  const coreMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: def.color ?? SF_COLORS.MILKY_WAY,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const core = new THREE.Sprite(coreMat)

  const coreSize = def.radius * 0.45

  core.scale.set(coreSize, coreSize, 1)

  group.add(core)

  const pick = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.5, 16, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  )

  group.add(pick)

  group.rotation.x = -Math.PI / 2 + (def.tilt ?? 0)

  return { group, pick }
}
