/**
 * @file engine/frame/updates.ts
 * @description Per-frame scene updates driven by `tickFrame` — approach
 * proximity prefetch, distance LOD, hierarchy-shell fade, volumetric
 * galaxy-cloud fade, deep-field star-cloud fade, and hover projection
 * tracking. Split out of frame.ts; every update is a no-op-safe early
 * return when its state is unarmed.
 */
import {
  SF_APPROACH,
  SF_LOD,
  SF_SPIRAL,
  SF_STAR_CLOUD,
  SF_STRUCTURE,
} from '@core/tokens/starfield/params.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { registryWorldPos } from '../registry.js'
import { anchorScreenPos, anchorWorldPos, worldScreenPos } from './camera.js'
import type { SFState } from '../types.js'

/**
 * Proximity check — when the camera comes within a body's approach
 * distance its dossier JSON prefetches via `onApproach`, once per body
 * per session (the `approached` set). Selection prefetches too, so a
 * slow drift-through and a direct nav click share one cache.
 * @param s Engine state.
 */
export function checkApproach(s: SFState): void {
  if (!s.camera || !s.onApproach) return

  const cam = s.camera.position

  for (const [id, anchor] of s.anchors) {
    if (s.approached.has(id)) continue

    const def = s.nodes.get(id)?.def

    if (!def) continue

    const p = anchorWorldPos(anchor)

    const dist = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z)

    if (dist < SF_APPROACH.PAD + def.radius * SF_APPROACH.SCALE) {
      s.approached.add(id)

      s.onApproach(id)
    }
  }
}

/**
 * Detail level-of-detail — toggles each node's secondary geometry
 * (shells, satellite pivots) by camera distance so remote
 * bodies draw as one primitive. Orbit radius counts toward `size` so a
 * body's ring stays visible while the camera is still inside it.
 * @param s Engine state.
 */
export function updateLod(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  // The deep-tier gate keys on how far the CAMERA is from the solar
  // barycenter, not the body: while the camera orbits inside the local
  // bubble the galactic centre, external galaxies and hierarchy shells
  // would render beside the solar system as if they were neighbors.
  const camHome = Math.hypot(cam.x, cam.y, cam.z)
  const deepOn = camHome > SF_LOD.DEEP_REVEAL

  for (const node of s.nodes.values()) {
    const def = node.def

    const deep =
      def.kind === SF_KINDS.BLACK_HOLE ||
      def.kind === SF_KINDS.STRUCTURE ||
      ((def.kind === SF_KINDS.GALAXY || def.kind === SF_KINDS.DWARF_GALAXY) &&
        !def.spiralDisc?.volumetric)

    if (deep && !deepOn) {
      node.pivot.visible = false
      continue
    }

    node.pivot.visible = true

    if (!node.detail?.length) continue

    const p = anchorWorldPos(node.mesh)

    const dist = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z)

    const size = Math.max(node.def.radius, node.def.orbit ?? 0)

    const near = dist < SF_LOD.PAD + size * SF_LOD.SCALE

    for (const obj of node.detail) {
      obj.visible = near
    }
  }
}

/**
 * Cosmic-hierarchy shell fade — hides the inside of every boundary bubble
 * while the camera is deep within it. A huge fresnel shell viewed from
 * the interior paints a bright silhouette over the whole sky (the giant
 * cream-ball bug), so each structure's shell ramps to visible only once
 * the camera has pulled back to 1.25–1.7× its radius.
 * @param s Engine state.
 */
export function updateStructures(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  for (const node of s.nodes.values()) {
    if (node.def.kind !== 'structure') continue

    const p = anchorWorldPos(node.mesh)

    const d = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z)
    const r = node.def.structure?.radius ?? node.def.radius

    // 0 when deep inside, 1 once the camera has pulled back past the shell.
    const fade = smoothstep(r * SF_STRUCTURE.FADE_IN, r * SF_STRUCTURE.FADE_OUT, d)

    const fadeUniform = node.mesh.userData?.fade

    if (fadeUniform) fadeUniform.value = fade

    const speckleMat = node.mesh.userData?.speckleMat as { opacity?: number } | null

    if (speckleMat) {
      // Keep a whisper of member galaxies visible from the inside, ramp
      // to full opacity when the shell itself is visible.
      speckleMat.opacity = SF_STRUCTURE.SPECKLE_OPACITY * (0.45 + 0.55 * fade)
    }
  }
}

/**
 * Volumetric galaxy cloud fade — the Milky Way's particle disc is
 * viewed from inside. Without distance attenuation the hundreds of
 * thousands of additive points stack into an opaque glowing ball that
 * swallows the view; fade them down while the camera is embedded, and
 * ramp up as the camera pulls back far enough to read the disc as a
 * whole. Only volumetric clouds carry the marker.
 * @param s Engine state.
 */
export function updateGalaxyClouds(s: SFState): void {
  if (!s.camera) return

  const cam = s.camera.position

  for (const node of s.nodes.values()) {
    if (!node.def.spiralDisc?.volumetric) continue

    const p = anchorWorldPos(node.mesh)

    const dx = cam.x - p.x
    const dy = cam.y - p.y
    const dz = cam.z - p.z
    const dist = Math.hypot(dx, dy, dz)
    const r = node.def.radius

    // Fade 0 while deep inside the disc, ramp to 1 once outside ~0.85r.
    // Squaring the smoothstep keeps the interior much darker so the
    // embedded Milky Way reads as a faint band, not an opaque glowing ball.
    const fade = smoothstep(r * 0.25, r * 0.85, dist) ** 2

    const points = node.mesh.children.find((c) => c.userData?.volumetric) as
      { material?: { opacity?: number; size?: number } } | undefined

    if (points?.material) {
      // The far gain lifts opacity past VOLUMETRIC_OPACITY once the
      // camera is clear of the disc — from galactic range the whole
      // 400k-point field thins into a uniform wash at base opacity, so
      // the arms need the extra light to resolve as structure.
      points.material.opacity =
        SF_SPIRAL.VOLUMETRIC_OPACITY *
        (0.2 + 0.8 * fade) *
        (1 + fade * SF_SPIRAL.VOLUMETRIC_FAR_GAIN)

      // Angular-size floor — sizeAttenuation renders gl_PointSize as
      // `size·(0.5·viewH)/dist` (three ignores fov for points), so
      // world-unit points collapse to sub-pixel dust once the camera
      // leaves the disc and the spiral vanished entirely from outside.
      // Real stars are point sources whose apparent size floors near
      // ~1 px: scaling the world size with camera distance reproduces
      // that limit, so the arms stay resolved at galactic range while
      // remaining fine pinpoints from inside the bubble.
      const viewH = s.canvas?.clientHeight || 0

      if (points.material.size != null && viewH) {
        const wpp = dist / (viewH * 0.5)

        points.material.size = Math.max(
          SF_SPIRAL.VOLUMETRIC_PX,
          wpp * SF_SPIRAL.VOLUMETRIC_PX_SCREEN
        )
      }
    }
  }
}

/**
 * Deep-field cloud camera fade — the real catalogue surrounds the Sun
 * isotropically, so pulled far enough back it reads as a solid glowing
 * sphere regardless of the per-star edge fade. While the camera is
 * embedded the full density is correct (the local stellar neighborhood
 * IS a volume); once outside, the cloud rolls down to a faint floor so
 * it dissolves into the Milky Way disc instead of painting a ball.
 * @param s Engine state.
 */
export function updateStarCloud(s: SFState): void {
  if (!s.camera || !s.starCloud) return

  const cam = s.camera.position

  // The cloud rides the rotating disc inside the galactic rider, so the
  // camera distance is measured to the cloud's own world position —
  // matrixWorld elements [12..14] are the translation column, read
  // allocation-free.
  const e = (s.starCloud as { matrixWorld?: { elements: number[] } }).matrixWorld?.elements

  const cx = e?.[12] ?? 0
  const cy = e?.[13] ?? 0
  const cz = e?.[14] ?? 0

  const dist = Math.hypot(cam.x - cx, cam.y - cy, cam.z - cz)

  const fade = smoothstep(SF_STAR_CLOUD.CAM_FADE_IN, SF_STAR_CLOUD.CAM_FADE_OUT, dist)

  const mat = (s.starCloud as { material?: { opacity?: number } }).material

  if (mat?.opacity != null) {
    mat.opacity =
      SF_STAR_CLOUD.OPACITY *
      (SF_STAR_CLOUD.CAM_FADE_FLOOR + (1 - SF_STAR_CLOUD.CAM_FADE_FLOOR) * (1 - fade))
  }
}

/**
 * Hover tracking — re-projects the hovered anchor each tick and reports
 * canvas-space pixels so the DOM tooltip + leader line track orbiting
 * bodies. The navigator-hover hint takes precedence over the raycast
 * hover (the pointer is on the drawer) and resolves its stored anchor
 * or shard record into a live world point, then an edge-clamped screen
 * point that locates the body at any zoom level.
 * Fires nothing when hover is idle (no per-frame DOM churn).
 * @param s Engine state.
 */
export function trackHover(s: SFState): void {
  const id = s.hint?.id ?? s.hoverId

  if (!id || !s.onHoverMove) return

  if (s.hint) {
    const p = s.hint.anchor?.getWorldPosition
      ? anchorWorldPos(s.hint.anchor)
      : s.hint.rec
        ? registryWorldPos(s, s.hint.rec)
        : null

    const pos = worldScreenPos(p, s)

    if (pos) s.onHoverMove(id, pos.x, pos.y, pos.edge, pos.angle)

    return
  }

  const anchor = s.anchors.get(id)

  if (!anchor) return

  const pos = anchorScreenPos(anchor, s)

  if (pos) s.onHoverMove(id, pos.x, pos.y)
}

/**
 * Day/night uniform feed — for every body whose shading depends on the
 * sun direction (night-lights emissive gating, atmosphere rim shells)
 * writes `dir = normalize(sunPos − bodyPos)` into the shared vector the
 * material's TSL uniform wraps. `anchorWorldPos`'s shared scratch is
 * copied before the loop so the sun position survives each resolution.
 * @param s Engine state.
 */
export function updateDayNight(s: SFState): void {
  if (!s.dayNight?.length || !s.sunLight) return

  const sun = { ...anchorWorldPos(s.sunLight as never) }

  for (const dn of s.dayNight) {
    const p = anchorWorldPos(dn.anchor as never)

    dn.dir.set(sun.x - p.x, sun.y - p.y, sun.z - p.z)

    const len = Math.hypot(dn.dir.x, dn.dir.y, dn.dir.z)

    if (len > 0) {
      dn.dir.x /= len
      dn.dir.y /= len
      dn.dir.z /= len
    }
  }
}

/** Local smoothstep helper — mirrors GLSL, no dependency on three.js. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))

  return t * t * (3 - 2 * t)
}
