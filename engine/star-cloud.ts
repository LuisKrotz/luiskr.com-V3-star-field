/**
 * @file engine/star-cloud.ts
 * @description Real-catalogue deep field — decodes
 * `public/data/deep-field.bin` (139,563 catalogued objects:
 * 119,626 HYG/Hipparcos stars, 5,974 NASA Exoplanet Archive planets,
 * 13,963 OpenNGC deep-sky objects — packed little-endian Float32
 * x,y,z,mag,ci,kind per record behind a uint32 count header) into a
 * single THREE.Points draw call. The catalogue is heliocentric, so the
 * cloud mounts on the Sun's own pivot at the scene origin — the dense
 * real stellar neighbourhood surrounds the solar system and resolves
 * when the camera zooms in — the honest middle layer between the 66
 * hand-authored bodies and the million-point procedural discs.
 */
import { SF_BODY_IDS, SF_COLORS, SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'
import { sfChartDist } from './scale.js'
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
 * Builds the deep-field Points object from the decoded buffer — one
 * vertex per catalogued object across three real datasets:
 *   kind 0 — 119,626 HYG stars (galactic heliocentric xyz)
 *   kind 1 — 5,974 NASA Exoplanet Archive planets (host-star positions)
 *   kind 2 — 13,963 OpenNGC deep-sky objects (galaxies, clusters,
 *            nebulae — redshift-derived or type-typical distances)
 * Positions convert heliocentric light-years to chart units through
 * the shared `sfChartDist` three-tier compression — the same scale the
 * authored catalog and registry fly-to math use, so real stars land
 * inside the procedural Milky Way disc and real DSOs populate the
 * far-field tiers. Vertex colour follows the B-V spectral ramp
 * for stars and a kind tint for planets/DSOs, scaled by magnitude.
 * @param THREE The three.js module.
 * @param buf Raw ArrayBuffer of `deep-field.bin`.
 * @returns The Points object, or null when the buffer is malformed.
 */
function buildCloud(
  THREE: ThreeModule,
  buf: ArrayBuffer
): ReturnType<ThreeModule['Points']['prototype']['clone']> | null {
  const view = new DataView(buf)

  // Header: uint32 little-endian record count — clamped by MAX_STARS so
  // a corrupted file cannot blow the GPU buffer allocation.
  const count = Math.min(view.getUint32(0, true), SF_STAR_CLOUD.MAX_STARS)

  if (count === 0 || buf.byteLength < 4 + count * SF_STAR_CLOUD.STRIDE * 4) return null

  const data = new Float32Array(buf, 4, count * SF_STAR_CLOUD.STRIDE)

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  const exoTint = new THREE.Color(SF_COLORS.EXOPLANET_PT)

  const dsoTint = new THREE.Color(SF_COLORS.DSO_PT)

  for (let i = 0; i < count; i++) {
    const base = i * SF_STAR_CLOUD.STRIDE

    // Heliocentric galactic ly → chart units via the shared three-tier
    // scale. `k` rescales each object's true direction vector onto its
    // compressed chart radius — directions stay astronomically honest,
    // only distances compress. The axis map matches `sfGalacticPos`:
    // chart X = −x_gal (galactic centre lands at −X, where the Milky
    // Way disc is centred), Y = z_gal (north galactic pole up),
    // Z = y_gal; the cloud's rotation.x then leans the plane onto the
    // rendered disc tilt.
    const gx = data[base]
    const gy = data[base + 1]
    const gz = data[base + 2]

    const dLy = Math.sqrt(gx * gx + gy * gy + gz * gz)

    const k = dLy > 0 ? sfChartDist(dLy) / dLy : 0

    pos[i * 3] = -gx * k
    pos[i * 3 + 1] = gz * k
    pos[i * 3 + 2] = gy * k

    const mag = data[base + 3]

    const ci = data[base + 4]

    const kind = data[base + 5]

    const [r0, g0, b0] =
      kind === SF_STAR_CLOUD.KIND_EXOPLANET
        ? [exoTint.r, exoTint.g, exoTint.b]
        : kind === SF_STAR_CLOUD.KIND_DSO
          ? [dsoTint.r, dsoTint.g, dsoTint.b]
          : spectralColor(ci, THREE)

    // Apparent magnitude → relative brightness: mag −1 (Sirius-class)
    // saturates at ~1.2, mag 9 (faintest in the set) dims to the floor
    // so the naked-eye field dominates and faint stars read as dust.
    const bright = Math.max(
      SF_STAR_CLOUD.MAG_FLOOR,
      SF_STAR_CLOUD.MAG_BIAS - mag * SF_STAR_CLOUD.MAG_SLOPE
    )

    col[i * 3] = r0 * bright
    col[i * 3 + 1] = g0 * bright
    col[i * 3 + 2] = b0 * bright
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

  // Raycasts skip the 139k-point cloud — catalog bodies own picking.
  points.raycast = () => undefined

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

      // Mount on the Sun's *pivot*, not the galaxy's — the catalogue is
      // heliocentric, so its center must BE the Sun and its axes must
      // stay world-fixed while body meshes spin. The cloud's own
      // rotation.x tilts the real galactic plane onto the Milky Way
      // disc's rendered tilt so nearby stars lie in it.
      const sun = s.nodes.get(SF_BODY_IDS.SUN)

      const mw = s.nodes.get(SF_BODY_IDS.MILKY_WAY)

      if (sun) {
        cloud.rotation.x = -Math.PI / 2 + (mw?.def.tilt ?? 0)

        sun.pivot.add(cloud)
      }

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
