/**
 * @file engine/spiral.ts
 * @description Spiral-galaxy surface — two-layer composite: a tilted
 * photographic disc (masked NASA/ESA imagery, `makeGalaxyDisc`) plus a
 * soft sparkle Points layer of foreground stars so the body keeps
 * per-pixel parallax when the camera sweeps past it. A warm additive
 * core sprite and an invisible pick sphere ride in the same group so
 * raycasts/hover resolve the galaxy without touching point geometry.
 *
 * When the photo texture never loaded the builder falls back to the
 * procedural seeded spiral (log-spiral arms + bulge, soft-sprite
 * points) — the catalog still renders a real disc instead of a hole.
 *
 * The distribution is deterministic (seeded LCG) so every boot draws the
 * same galaxy — no flicker between visits, no per-frame allocation.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { makeGalaxyDisc } from './bodies/deep-sky.js'
import { lcg, seedFrom } from './rand.js'
import { matParams } from './materials.js'
import type { SFBodyDef } from './types.js'

type ThreeModule = typeof import('three')

/**
 * Fills the position + color buffers for one spiral galaxy: `BULGE`
 * fraction of points cluster in the core (tight gaussian), the rest
 * follow `ARMS` logarithmic arms with angular jitter and a thin vertical
 * gaussian so the disc reads as a real spiral at any tilt. An optional
 * `halo` fraction peels off the tail of the buffer into a spherical
 * stellar-halo distribution (globular-cluster haze standing in for the
 * oldest populations), and `thick` multiplies disc thickness for bodies
 * like the Milky Way whose volume must read as a 3-D object from inside.
 * @param pos Float32 xyz buffer (COUNT×3).
 * @param col Float32 rgb buffer (COUNT×3).
 * @param radius Disc radius in scene units.
 * @param rand Seeded LCG.
 * @param count Point count to fill.
 * @param arms Spiral arm count.
 * @param thick Disc-thickness multiplier on `SF_SPIRAL.THIN`.
 * @param halo Fraction (0–1) of points scattered into a spherical halo.
 * @param bubble Optional heliocentric exclusion zone — `{ x, y, z, r }`
 *   in the galaxy's local frame; points falling inside are resampled so
 *   *   no disc star overlaps the solar system.
 */
function fillSpiral(
  pos: Float32Array,
  col: Float32Array,
  radius: number,
  rand: () => number,
  count: number,
  arms: number,
  thick = 1,
  halo = 0,
  bubble?: { x: number; y: number; z: number; r: number }
): void {
  const bulgeCount = Math.floor(count * SF_SPIRAL.BULGE)

  const haloCount = Math.floor(count * halo)

  for (let i = 0; i < count; i++) {
    const inHalo = i >= count - haloCount

    const inBulge = i < bulgeCount

    if (inHalo) {
      // Stellar halo — uniform spherical gaussian around the core, far
      // thicker than the disc; dimmed toward the edge ramp so it reads
      // as a faint enveloping haze, not a second disc.
      const rr = Math.abs(rand() + rand() - 1) * radius * SF_SPIRAL.HALO_RADIUS

      const u = rand() * 2 - 1

      const theta = rand() * Math.PI * 2

      const s = Math.sqrt(1 - u * u)

      pos[i * 3] = Math.cos(theta) * s * rr
      pos[i * 3 + 1] = u * rr
      pos[i * 3 + 2] = Math.sin(theta) * s * rr

      const k = 0.5 + 0.5 * (rr / (radius * SF_SPIRAL.HALO_RADIUS))

      col[i * 3] = SF_SPIRAL.CORE_R + (SF_SPIRAL.EDGE_R - SF_SPIRAL.CORE_R) * k
      col[i * 3 + 1] = SF_SPIRAL.CORE_G + (SF_SPIRAL.EDGE_G - SF_SPIRAL.CORE_G) * k
      col[i * 3 + 2] = SF_SPIRAL.CORE_B + (SF_SPIRAL.EDGE_B - SF_SPIRAL.CORE_B) * k
    } else {
      // Radial distance — bulge is tight gaussian; arms spread sqrt-uniform.
      const r = inBulge ? Math.abs(rand() + rand() - 1) * radius * 0.16 : Math.sqrt(rand()) * radius

      // Arm phase — log-spiral wind + even arm offset + scatter jitter.
      const arm = i % arms

      const base = (r / radius) * SF_SPIRAL.WIND + (arm * Math.PI * 2) / arms

      const angle = inBulge ? rand() * Math.PI * 2 : base + (rand() - 0.5) * 0.42

      const y = (rand() + rand() - 1) * radius * SF_SPIRAL.THIN * thick * (inBulge ? 3.2 : 1)

      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = Math.sin(angle) * r

      // Warm core → cool edge ramp; bulge stays near-core tint.
      const k = inBulge ? 0.22 : r / radius

      col[i * 3] = SF_SPIRAL.CORE_R + (SF_SPIRAL.EDGE_R - SF_SPIRAL.CORE_R) * k
      col[i * 3 + 1] = SF_SPIRAL.CORE_G + (SF_SPIRAL.EDGE_G - SF_SPIRAL.CORE_G) * k
      col[i * 3 + 2] = SF_SPIRAL.CORE_B + (SF_SPIRAL.EDGE_B - SF_SPIRAL.CORE_B) * k
    }

    // Heliocentric exclusion bubble — the point just written (halo,
    // bulge or arm) resamples while it sits inside the Sun's carve-out,
    // so no disc star materializes on top of the solar system.
    if (bubble) {
      let tries = 0

      while (tries++ < 8) {
        const dx = pos[i * 3] - bubble.x

        const dy = pos[i * 3 + 1] - bubble.y

        const dz = pos[i * 3 + 2] - bubble.z

        if (dx * dx + dy * dy + dz * dz >= bubble.r * bubble.r) break

        pos[i * 3] = (rand() * 2 - 1) * radius
        pos[i * 3 + 1] = (rand() + rand() - 1) * radius * SF_SPIRAL.THIN * thick
        pos[i * 3 + 2] = (rand() * 2 - 1) * radius
      }
    }
  }
}

/**
 * Fills the buffers for an elliptical dwarf galaxy — no spiral structure,
 * just a smooth spheroid of old stars: a gaussian radial profile (dense
 * core, exponential fall-off) over uniform directions, flattened on Y so
 * the smudge reads as a dE/dSph rather than a ball. The `tint` hex steers
 * the vertex ramp so spheroidals glow warm and irregulars read cooler.
 * @param pos Float32 xyz buffer.
 * @param col Float32 rgb buffer.
 * @param radius Body radius in scene units.
 * @param rand Seeded LCG.
 * @param count Point count to fill.
 * @param tint RGB multiplier tint (from def.color channel components).
 */
function fillElliptical(
  pos: Float32Array,
  col: Float32Array,
  radius: number,
  rand: () => number,
  count: number,
  tint: [number, number, number]
): void {
  for (let i = 0; i < count; i++) {
    // Gaussian-ish radial profile — sum of three uniforms approximates a
    // normal; the ELLIPSE_FLAT squash on Y flattens the spheroid.
    const r = Math.abs(rand() + rand() + rand() - 1.5) * radius * SF_SPIRAL.ELLIPSE_RADIAL

    const u = rand() * 2 - 1

    const theta = rand() * Math.PI * 2

    const s = Math.sqrt(1 - u * u)

    pos[i * 3] = Math.cos(theta) * s * r
    pos[i * 3 + 1] = u * r * SF_SPIRAL.ELLIPSE_FLAT
    pos[i * 3 + 2] = Math.sin(theta) * s * r

    // Bright core → dim rim; tint applies the dwarf's population color.
    const k = Math.min(1, r / radius)

    // Rim roll-off — the radial fill cuts off at ~1.5×ELLIPSE_RADIAL of
    // the radius; fading brightness to zero across the outer band keeps
    // the cutoff invisible so the dwarf melts into the sky.
    const edgeNorm = r / (radius * SF_SPIRAL.ELLIPSE_RADIAL * 1.5)

    const edgeFade =
      1 -
      Math.min(1, Math.max(0, (edgeNorm - SF_SPIRAL.ELLIPSE_EDGE) / (1 - SF_SPIRAL.ELLIPSE_EDGE)))

    const bright = (SF_SPIRAL.ELLIPSE_CORE - k * SF_SPIRAL.ELLIPSE_FADE) * edgeFade

    col[i * 3] = tint[0] * bright
    col[i * 3 + 1] = tint[1] * bright
    col[i * 3 + 2] = tint[2] * bright
  }
}

/**
 * One soft-sprite Points cloud — the shared glow texture gives each
 * vertex a round airbrushed edge instead of the default square splat,
 * which is what turned the old cloud into a hard-edged white blob.
 * @param THREE The three.js module.
 * @param pos xyz vertex buffer.
 * @param col rgb vertex buffer.
 * @param sizePx Point size in world units.
 * @param glowTex Shared soft-disc texture (may be undefined).
 */
function makeStarPoints(
  THREE: ThreeModule,
  pos: Float32Array,
  col: Float32Array,
  sizePx: number,
  glowTex: THREE_NS.Texture | undefined
): THREE_NS.Points {
  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  // Empty uv — the node pipeline samples `uv` for `map` even though
  // points shade via gl_PointCoord; declaring it keeps the graph quiet.
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2))

  const mat = new THREE.PointsMaterial(
    matParams({
      size: sizePx,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  )

  const points = new THREE.Points(geo, mat)

  // Keep raycasts off the point cloud — the pick sphere handles hover.
  points.raycast = () => undefined

  return points
}

/**
 * Builds a spiral galaxy node: tilted group containing the photographic
 * disc (or the seeded procedural spiral when no photo resolved), a soft
 * sparkle layer of foreground stars for depth, a warm additive core
 * sprite for the bulge glow, and an invisible sphere carrying
 * `userData.bodyId` so picking/hover work against a real mesh.
 * @param THREE The three.js module.
 * @param def Catalog galaxy entry (radius = disc radius, tilt = disc
 * tilt, `spiralDisc.count` = particle target standing in for the true
 * stellar population — capped by `COUNT_MAX` and quartered on mobile).
 * @param texMap Loaded texture map keyed by URL — the body's `texture`
 * resolves through it; a missing/absent entry keeps the procedural path.
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 * @param mobile Whether to apply the mobile divisor (small viewport).
 * @returns `{ group, pick, points }` — the spin target, the pickable
 * mesh, and the sparkle/cloud Points.
 */
export function makeSpiralGalaxy(
  THREE: ThreeModule,
  def: SFBodyDef,
  texMap: Map<string, THREE_NS.Texture> | undefined,
  glowTex: THREE_NS.Texture | undefined,
  mobile = false
): { group: THREE_NS.Object3D; pick: THREE_NS.Object3D; points: THREE_NS.Points } {
  const group = new THREE.Group()

  const asked = Math.min(def.spiralDisc?.count ?? SF_SPIRAL.COUNT, SF_SPIRAL.COUNT_MAX)

  const count = mobile ? Math.max(1, Math.floor(asked / SF_SPIRAL.MOBILE_DIVISOR)) : asked

  const arms = def.spiralDisc?.arms ?? SF_SPIRAL.ARMS

  // Volumetric galaxies (the Milky Way — viewed from inside) never load
  // a photo quad: a face-on billboard is geometrically false for an
  // embedded observer, so the particle disc IS the body.
  const photoTex = def.spiralDisc?.volumetric
    ? undefined
    : def.texture
      ? texMap?.get?.(def.texture)
      : undefined

  if (photoTex) {
    // Photographic path — masked disc carries the true imagery; the
    // group owns the tilt, so the disc lays flat locally (0).
    group.add(makeGalaxyDisc(THREE, def, texMap as Map<string, THREE_NS.Texture>, glowTex, 0))
  }

  // Sparkle layer — over the photo it is a sparse foreground-star cloud
  // (resolved star-forming knots riding the imagery); in the fallback it
  // IS the galaxy body, so it takes the full particle budget. Always
  // seeded, so the speckle pattern is stable across visits.
  const sparkleCount = photoTex ? Math.max(64, Math.floor(count * SF_DETAIL.SPARKLE_FRAC)) : count

  const pos = new Float32Array(sparkleCount * 3)

  const col = new Float32Array(sparkleCount * 3)

  const rand = lcg(seedFrom(def.id))

  if (def.spiralDisc?.elliptical) {
    // Dwarf spheroidal/irregular — smooth unresolved smudge tinted by
    // the catalog color (warm old population vs cool irregular haze).
    const c = new THREE.Color(def.color ?? SF_COLORS.DWARF_SPH)

    fillElliptical(pos, col, def.radius, rand, sparkleCount, [c.r, c.g, c.b])
  } else {
    // The heliocentric bubble lives in the group's LOCAL frame — the
    // Sun sits at the world origin, so its local coords are the inverse
    // rotation.x of `−def.pos` (for the MW: def.pos=(−267,0,0) → local
    // (267,0,0), the Sun's true galactocentric ring).
    let bubble: { x: number; y: number; z: number; r: number } | undefined

    if (def.spiralDisc?.bubble && def.pos) {
      const a = -Math.PI / 2 + (def.tilt ?? 0)

      const wy = -def.pos[1]

      const wz = -def.pos[2]

      bubble = {
        x: -def.pos[0],
        y: wy * Math.cos(-a) - wz * Math.sin(-a),
        z: wy * Math.sin(-a) + wz * Math.cos(-a),
        r: def.spiralDisc.bubble,
      }
    }

    fillSpiral(
      pos,
      col,
      def.radius,
      rand,
      sparkleCount,
      arms,
      def.spiralDisc?.thick ?? 1,
      def.spiralDisc?.halo ?? 0,
      bubble
    )
  }

  const points = makeStarPoints(
    THREE,
    pos,
    col,
    photoTex ? SF_DETAIL.SPARKLE_PX : SF_SPIRAL.POINT_PX,
    glowTex
  )

  group.add(points)

  const coreMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: def.color ?? SF_COLORS.MILKY_WAY,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // The photo already carries its own luminous core — the sprite only
    // adds bloom on the fallback path; over imagery it stays a whisper.
    opacity: photoTex ? SF_SPIRAL.CORE_PHOTO : SF_SPIRAL.CORE_GLOW,
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

  return { group, pick, points }
}
