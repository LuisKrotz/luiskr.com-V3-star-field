/**
 * @file engine/star-cloud.ts
 * @description Real-catalogue star field — decodes
 * `public/data/milky-way-stars.bin` (78k HYG/Hipparcos stars, mag ≤ 9,
 * heliocentric light-years, packed little-endian Float32 x,y,z,mag,ci
 * per record behind a uint32 count header) into a single THREE.Points
 * draw call. The cloud mounts onto the Milky Way spiral group at the
 * Sun's true galactocentric offset (`SUN_GC_LY`), so when the camera
 * zooms toward the disc the dense real stellar neighbourhood resolves
 * instead of a stylized sprite — the honest middle layer between the
 * 66 hand-authored bodies and the million-point procedural discs.
 */
import { SF_BODY_IDS, SF_COLORS, SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'
import type { SFState } from './types.js'
import { devError } from '@core/devlog.js'

type ThreeModule = typeof import('three')

/**
 * Converts a B-V colour index into an [r,g,b] triple in 0–1 space.
 * The HYG `ci` column runs roughly −0.4 (hot O stars) to +2.0 (cool M
 * dwarfs); four tokenized stops interpolate linearly between spectral
 * tints so no hardcoded colours leak into the loop.
 * @param ci B-V colour index of the star.
 * @param THREE The three.js module (for `Color` channel math).
 * @returns `[r,g,b]` in linear 0–1 range.
 */
function spectralColor(ci: number, THREE: ThreeModule): [number, number, number] {
  const c = new THREE.Color()

  if (ci <= SF_STAR_CLOUD.CI_LOW) {
    c.setHex(SF_COLORS.STAR_BLUE)
  } else if (ci <= SF_STAR_CLOUD.CI_WARM) {
    // Blue → white ramp across the O/A/F range.
    const k = ci / (SF_STAR_CLOUD.CI_WARM - SF_STAR_CLOUD.CI_LOW)

    c.setHex(SF_COLORS.STAR_BLUE).lerp(new THREE.Color(SF_COLORS.STAR_WHITE), k)
  } else if (ci <= SF_STAR_CLOUD.CI_GOLD) {
    // White → gold across the F/G range (Sun's 0.656 lands here).
    const k = (ci - SF_STAR_CLOUD.CI_WARM) / (SF_STAR_CLOUD.CI_GOLD - SF_STAR_CLOUD.CI_WARM)

    c.setHex(SF_COLORS.STAR_WHITE).lerp(new THREE.Color(SF_COLORS.STAR_GOLD), k)
  } else if (ci <= SF_STAR_CLOUD.CI_RED) {
    // Gold → orange-red across K and early-M.
    const k = (ci - SF_STAR_CLOUD.CI_GOLD) / (SF_STAR_CLOUD.CI_RED - SF_STAR_CLOUD.CI_GOLD)

    c.setHex(SF_COLORS.STAR_GOLD).lerp(new THREE.Color(SF_COLORS.STAR_RED), k)
  } else {
    c.setHex(SF_COLORS.STAR_RED)
  }

  return [c.r, c.g, c.b]
}

/**
 * Builds the star-cloud Points object from the decoded buffer.
 * Positions convert heliocentric light-years to chart units
 * (`UNITS_PER_LY` — the same 830 ly/unit the deep-space catalog uses,
 * so the cloud is spatially coherent with Andromeda's authored
 * distance); each vertex colour multiplies the B-V spectral tint by a
 * magnitude-brightness curve so bright stars carry the field visually.
 * @param THREE The three.js module.
 * @param buf Raw ArrayBuffer of `milky-way-stars.bin`.
 * @returns The Points object, or null when the buffer is malformed.
 */
function buildCloud(
  THREE: ThreeModule,
  buf: ArrayBuffer
): ReturnType<ThreeModule['Points']['prototype']['clone']> | null {
  const view = new DataView(buf)

  // Header: uint32 little-endian star count — clamped by MAX_STARS so a
  // corrupted file cannot blow the GPU buffer allocation.
  const count = Math.min(view.getUint32(0, true), SF_STAR_CLOUD.MAX_STARS)

  if (count === 0 || buf.byteLength < 4 + count * SF_STAR_CLOUD.STRIDE * 4) return null

  const data = new Float32Array(buf, 4, count * SF_STAR_CLOUD.STRIDE)

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const base = i * SF_STAR_CLOUD.STRIDE

    // heliocentric ly → chart units (830 ly/unit, catalog-consistent).
    pos[i * 3] = data[base] * SF_STAR_CLOUD.UNITS_PER_LY
    pos[i * 3 + 1] = data[base + 1] * SF_STAR_CLOUD.UNITS_PER_LY
    pos[i * 3 + 2] = data[base + 2] * SF_STAR_CLOUD.UNITS_PER_LY

    const mag = data[base + 3]

    const ci = data[base + 4]

    const [r, g, b] = spectralColor(ci, THREE)

    // Apparent magnitude → relative brightness: mag −1 (Sirius-class)
    // saturates at ~1.2, mag 9 (faintest in the set) dims to the floor
    // so the naked-eye field dominates and faint stars read as dust.
    const bright = Math.max(
      SF_STAR_CLOUD.MAG_FLOOR,
      SF_STAR_CLOUD.MAG_BIAS - mag * SF_STAR_CLOUD.MAG_SLOPE
    )

    col[i * 3] = r * bright
    col[i * 3 + 1] = g * bright
    col[i * 3 + 2] = b * bright
  }

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const mat = new THREE.PointsMaterial({
    size: SF_STAR_CLOUD.POINT_PX,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geo, mat)

  // Raycasts skip the 78k-point cloud — catalog bodies own picking.
  points.raycast = () => undefined

  // Mount at the Sun's galactocentric radius inside the galaxy group's
  // local (tilted) frame: +X becomes "toward the rim" once the parent
  // tilt applies — a dense real cluster sitting on the disc, not a
  // free-floating cloud.
  const off = SF_STAR_CLOUD.SUN_GC_LY * SF_STAR_CLOUD.UNITS_PER_LY

  points.position.set(off, 0, 0)

  return points
}

/**
 * Lazy-loads the real star field once per boot — fired fire-and-forget
 * from bootstrap after the body graph exists, so the 1.5 MB binary
 * streams in the background and the cloud fades in on the disc when it
 * decodes. No-ops on repeat calls, dispose, or fetch failure.
 * @param s Star engine state bag.
 * @param THREE The three.js module (lazy-loaded by bootstrap).
 */
export function ensureStarCloud(s: SFState, THREE: ThreeModule): void {
  if (s.starCloudLoading || s.starCloud || s.disposed) return

  s.starCloudLoading = true

  fetch(`${SF_DATA_BASE}/${SF_STAR_CLOUD.FILE}`)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .then((buf) => {
      if (!buf || s.disposed) return

      const cloud = buildCloud(THREE, buf)

      if (!cloud) return

      // Attach inside the Milky Way node mesh — the spiral group carries
      // the disc tilt, so the cloud lands on the disc plane at the Sun's
      // real galactocentric radius and rotates with the galaxy spin.
      const mw = s.nodes.get(SF_BODY_IDS.MILKY_WAY)

      mw?.mesh.add(cloud)

      s.starCloud = cloud
    })
    .catch((e) => {
      devError('[StarField] star-cloud error:', e)
    })
}

/**
 * Disposes the cloud geometry/material on engine teardown so a hot
 * reload does not leak the 78k-point buffers.
 * @param s Star engine state bag.
 */
export function disposeStarCloud(s: SFState): void {
  const cloud = s.starCloud as unknown as {
    geometry?: { dispose(): void }
    material?: { dispose(): void }
    parent?: { remove(o: unknown): void }
  } | null

  cloud?.parent?.remove(cloud)
  cloud?.geometry?.dispose()
  cloud?.material?.dispose()

  s.starCloud = null
}
