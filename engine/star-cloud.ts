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
import type * as THREE_NS from 'three'
import { SF_BODY_IDS, SF_COLORS, SF_STAR_CLOUD, SF_SCALE } from '@core/tokens/starfield/params.js'
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'
import { WASM_ACTIONS, fillField } from './fill-worker.js'
import { sfChartDist } from './scale.js'
import type { SFState } from './types.js'
import { devError } from '@core/devlog.js'

type ThreeModule = typeof import('three')

/** RGB channel triple in 0–1 space. */
type Rgb = [number, number, number]

/**
 * Unpacks a packed hex color into a normalized channel triple — pure
 * math (no THREE.Color) so the identical code path runs inside the
 * decode workers.
 * @param hex Packed color int.
 */
function rgbOf(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

/** Linear channel-triple lerp. */
function lerpRgb(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/**
 * Converts a B-V colour index into an [r,g,b] triple in 0–1 space.
 * The HYG `ci` column runs roughly −0.4 (hot O stars) to +2.0 (cool M
 * dwarfs); four tokenized stops interpolate linearly between spectral
 * tints so no hardcoded colours leak into the loop.
 * @param ci B-V colour index of the star.
 * @returns `[r,g,b]` in linear 0–1 range.
 */
function spectralColor(ci: number): Rgb {
  const blue = rgbOf(SF_COLORS.STAR_BLUE)
  const white = rgbOf(SF_COLORS.STAR_WHITE)
  const gold = rgbOf(SF_COLORS.STAR_GOLD)
  const red = rgbOf(SF_COLORS.STAR_RED)

  if (ci <= SF_STAR_CLOUD.CI_LOW) return blue

  if (ci <= SF_STAR_CLOUD.CI_WARM) {
    return lerpRgb(blue, white, ci / (SF_STAR_CLOUD.CI_WARM - SF_STAR_CLOUD.CI_LOW))
  }

  if (ci <= SF_STAR_CLOUD.CI_GOLD) {
    return lerpRgb(
      white,
      gold,
      (ci - SF_STAR_CLOUD.CI_WARM) / (SF_STAR_CLOUD.CI_GOLD - SF_STAR_CLOUD.CI_WARM)
    )
  }

  if (ci <= SF_STAR_CLOUD.CI_RED) {
    return lerpRgb(
      gold,
      red,
      (ci - SF_STAR_CLOUD.CI_GOLD) / (SF_STAR_CLOUD.CI_RED - SF_STAR_CLOUD.CI_GOLD)
    )
  }

  return red
}

/**
 * Decodes one record range of the packed deep-field binary into pos/col
 * buffers — identical math to the SF_DECODE_DEEPFIELD worker handler so
 * a chunk computed locally is indistinguishable from a worker result.
 * Records: kind 0 — HYG stars (galactic heliocentric xyz), kind 1 —
 * NASA Exoplanet Archive planets, kind 2 — OpenNGC deep-sky objects.
 * Positions convert heliocentric light-years to chart units through the
 * shared `sfChartDist` three-tier compression; vertex colour follows
 * the B-V spectral ramp for stars and kind tints for planets/DSOs.
 * @param f32 Record view (x,y,z,mag,ci,kind ×N).
 * @param pos xyz buffer — compacted output from index 0.
 * @param col rgb buffer (same).
 * @param i0 First record index.
 * @param i1 One past the last record index.
 * @returns Live record count written (sentinel drops compact out).
 */
function decodeRange(
  f32: Float32Array,
  pos: Float32Array,
  col: Float32Array,
  i0: number,
  i1: number
): number {
  const exoTint = rgbOf(SF_COLORS.EXOPLANET_PT)

  const dsoTint = rgbOf(SF_COLORS.DSO_PT)

  let kept = 0

  for (let i = i0; i < i1; i++) {
    const base = i * SF_STAR_CLOUD.STRIDE

    // Heliocentric galactic ly → chart units via the shared three-tier
    // scale. `k` rescales each object's true direction vector onto its
    // compressed chart radius — directions stay astronomically honest,
    // only distances compress. The axis map matches `sfGalacticPos`:
    // chart X = −x_gal (galactic centre lands at −X, where the Milky
    // Way disc is centred), Y = z_gal (north galactic pole up),
    // Z = y_gal; the cloud's rotation.x then leans the plane onto the
    // rendered disc tilt.
    const gx = f32[base]
    const gy = f32[base + 1]
    const gz = f32[base + 2]

    const dLy = Math.sqrt(gx * gx + gy * gy + gz * gz)

    const kind = f32[base + 5]

    // Sentinel drop — ~1% of the star records sit at exactly ~100 kpc,
    // a sentinel shell the source catalogue assigns when parallax is
    // unmeasurable. Painted verbatim they draw a sparse ghost sphere at
    // ~3 200 chart units; the authored catalog covers true distant
    // objects, so these records are skipped entirely.
    if (kind === SF_STAR_CLOUD.KIND_STAR && dLy > SF_STAR_CLOUD.STAR_MAX_LY) continue

    const k = dLy > 0 ? sfChartDist(dLy) / dLy : 0

    pos[kept * 3] = -gx * k
    pos[kept * 3 + 1] = gz * k
    pos[kept * 3 + 2] = gy * k

    const mag = f32[base + 3]

    const ci = f32[base + 4]

    const [r0, g0, b0] =
      kind === SF_STAR_CLOUD.KIND_EXOPLANET
        ? exoTint
        : kind === SF_STAR_CLOUD.KIND_DSO
          ? dsoTint
          : spectralColor(ci)

    // Apparent magnitude → relative brightness: mag −1 (Sirius-class)
    // saturates at ~1.2, mag 9 (faintest in the set) dims to the floor
    // so the naked-eye field dominates and faint stars read as dust.
    // The edge factor fades the survey's selection boundary: the star
    // catalogue stops at ~3 200 ly, which painted a visible golden
    // sphere around the Sun — rolling brightness to zero across the
    // outer band dissolves the edge so the cloud melts into the Milky
    // Way disc instead of ending on a rim. DSOs are exempt: their own
    // compressed far-shell keeps them as faint background structure.
    const edge =
      kind === SF_STAR_CLOUD.KIND_DSO
        ? 1
        : 1 - Math.min(1, Math.max(0, (dLy - SF_STAR_CLOUD.EDGE_LY) / SF_STAR_CLOUD.EDGE_BAND_LY))

    const bright =
      Math.max(SF_STAR_CLOUD.MAG_FLOOR, SF_STAR_CLOUD.MAG_BIAS - mag * SF_STAR_CLOUD.MAG_SLOPE) *
      edge

    col[kept * 3] = r0 * bright
    col[kept * 3 + 1] = g0 * bright
    col[kept * 3 + 2] = b0 * bright

    kept++
  }

  return kept
}

/**
 * Builds the deep-field Points object from decoded buffers — one
 * vertex per catalogued object, vertex-colored by spectral ramp/kind
 * tint and magnitude. The decode itself runs chunked across the WASM
 * worker pool (SF_DECODE_DEEPFIELD) with `decodeRange` as the identical
 * local fallback.
 * @param THREE The three.js module.
 * @param pos Decoded xyz buffer.
 * @param col Decoded rgb buffer.
 * @returns The Points object.
 */
function buildCloud(THREE: ThreeModule, pos: Float32Array, col: Float32Array): THREE_NS.Points {
  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const mat = new THREE.PointsMaterial({
    size: SF_STAR_CLOUD.POINT_PX,
    vertexColors: true,
    transparent: true,
    opacity: SF_STAR_CLOUD.OPACITY,
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
 * decodes. The record decode dispatches chunked through the WASM worker
 * pool (the raw payload rides structuredClone so the main thread keeps
 * its buffer for the identical local fallback). No-ops on repeat calls,
 * dispose, or fetch failure.
 * @param s Star engine state bag.
 * @param THREE The three.js module (lazy-loaded by bootstrap).
 */
export function ensureStarCloud(s: SFState, THREE: ThreeModule): void {
  if (s.starCloudLoading || s.starCloud || s.disposed) return

  s.starCloudLoading = true

  fetch(`${SF_DATA_BASE}/${SF_STAR_CLOUD.FILE}`)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .then(async (buf) => {
      if (!buf || s.disposed) return

      // Header: uint32 little-endian record count — clamped by MAX_STARS
      // so a corrupted file cannot blow the GPU buffer allocation.
      const view = new DataView(buf)

      const count = Math.min(
        buf.byteLength >= 4 ? view.getUint32(0, true) : 0,
        SF_STAR_CLOUD.MAX_STARS
      )

      if (count === 0 || buf.byteLength < 4 + count * SF_STAR_CLOUD.STRIDE * 4) return

      // Worker params — every constant the decode handler needs, so the
      // off-thread math mirrors the token bags exactly.
      const p = {
        ...SF_STAR_CLOUD,
        GALACTIC_BREAK: SF_SCALE.GALACTIC_BREAK,
        GALACTIC_LY: SF_SCALE.GALACTIC_LY,
        LOCAL_GROUP_BREAK: SF_SCALE.LOCAL_GROUP_BREAK,
        LOCAL_GROUP_LY: SF_SCALE.LOCAL_GROUP_LY,
        COSMIC_LY: SF_SCALE.COSMIC_LY,
        COSMIC_CLAMP: SF_SCALE.COSMIC_CLAMP,
        STAR_BLUE: rgbOf(SF_COLORS.STAR_BLUE),
        STAR_WHITE: rgbOf(SF_COLORS.STAR_WHITE),
        STAR_GOLD: rgbOf(SF_COLORS.STAR_GOLD),
        STAR_RED: rgbOf(SF_COLORS.STAR_RED),
        EXO_TINT: rgbOf(SF_COLORS.EXOPLANET_PT),
        DSO_TINT: rgbOf(SF_COLORS.DSO_PT),
      }

      const res = await fillField(
        WASM_ACTIONS.SF_DECODE_DEEPFIELD,
        { data: new Uint8Array(buf, 4), count, p },
        count,
        false
      )

      let pos: Float32Array
      let col: Float32Array

      if (res) {
        pos = res.pos
        col = res.col
      } else {
        pos = new Float32Array(count * 3)
        col = new Float32Array(count * 3)

        const f32 = new Float32Array(buf, 4, count * SF_STAR_CLOUD.STRIDE)
        const kept = decodeRange(f32, pos, col, 0, count)

        pos = pos.slice(0, kept * 3)
        col = col.slice(0, kept * 3)
      }

      if (s.disposed) return

      const cloud = buildCloud(THREE, pos, col)

      // Mount on the Sun's *pivot*, not the galaxy's — the catalogue is
      // heliocentric, so its center must BE the Sun; riding the pivot
      // keeps it co-rotating with the Milky Way disc through the
      // galactic rider while its own rotation.x tilts the real galactic
      // plane onto the rendered disc tilt.
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
