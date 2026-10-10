/**
 * @file engine/bodies/deep-sky.ts
 * @description Real-imagery surface for deep-sky bodies — nebulae, star
 * clusters and external galaxies render as masked photographic
 * billboards/discs instead of tinted glow blobs. `maskPhotoTexture`
 * feathered alpha keeps the photo's rectangular frame invisible;
 * materials stay untinted (`SUN_LIGHT` white) so the imagery carries its
 * true astrophotography palette. When a texture never loaded (network
 * failure, missing file, or headless canvas) both makers fall back to
 * the tinted soft-glow sprite/plane the engine always had — the catalog
 * never blanks.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL } from '@core/tokens/starfield/params.js'
import { maskPhotoTexture, photoSize } from './mask.js'
import { matParams } from '../materials.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

/** Texture source map shared with bootstrap (URL → loaded texture). */
type TexMap = Map<string, THREE_NS.Texture>

/**
 * Billboard sprite for nebulae and star clusters — the real photo on a
 * camera-facing sprite with feathered edges and source aspect ratio
 * preserved. Additive blending + tint only on the procedural fallback,
 * where the glow texture stands in for imagery.
 * @param THREE The three.js module.
 * @param def Catalog entry (texture = photo URL, color = fallback tint).
 * @param texMap Loaded texture map keyed by URL.
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 */
export function makeNebulaSprite(
  THREE: ThreeModule,
  def: SFBodyDef,
  texMap: TexMap,
  glowTex: THREE_NS.Texture | undefined
): THREE_NS.Sprite {
  const photo = def.texture ? texMap.get(def.texture) : undefined

  const masked = photo ? maskPhotoTexture(THREE, photo) : undefined

  const mat = new THREE.SpriteMaterial(
    matParams({
      map: masked ?? photo ?? glowTex,
      // Untinted when real imagery renders — tint only colors the
      // procedural glow fallback.
      color: photo ? SF_COLORS.SUN_LIGHT : def.color,
      transparent: true,
      blending: photo ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    })
  )

  const sprite = new THREE.Sprite(mat)

  // Preserve the photo's aspect — a square scale on a wide Carina or
  // tall Horsehead would squash it into the blob shape we're removing.
  const [w, h] = photo ? photoSize(photo) : [0, 0]

  const size = def.radius * SF_DETAIL.GALAXY_DISC

  const sx = w && h ? size * Math.min(1, w / h) : size

  const sy = w && h ? size * Math.min(1, h / w) : size

  sprite.scale.set(sx, sy, 1)

  return sprite
}

/**
 * Tilted photographic disc for an external galaxy — the real image on a
 * plane lying in the body's disc plane, edge-feathered so it melts into
 * the skybox. The group's tilt (`def.tilt`) still applies; the spin
 * field rotates the photo in-plane, reading as the galaxy's true
 * rotation. Non-photo defs keep the soft glow disc.
 * @param THREE The three.js module.
 * @param def Catalog galaxy entry.
 * @param texMap Loaded texture map keyed by URL.
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 * @param localTilt Extra tilt in radians — callers whose parent group
 * already applies `def.tilt` (the spiral galaxy node) pass 0 so the
 * disc only lays flat into the group's local XZ plane.
 */
export function makeGalaxyDisc(
  THREE: ThreeModule,
  def: SFBodyDef,
  texMap: TexMap,
  glowTex: THREE_NS.Texture | undefined,
  localTilt?: number
): THREE_NS.Mesh {
  const photo = def.texture ? texMap.get(def.texture) : undefined

  const masked = photo ? maskPhotoTexture(THREE, photo) : undefined

  const size = def.radius * SF_DETAIL.GALAXY_DISC

  // Preserve the source aspect — a wide Triangulum squashed onto a
  // square plane would read as a distorted smear, not a galaxy.
  const [w, h] = photo ? photoSize(photo) : [0, 0]

  const sx = w && h ? size * Math.min(1, w / h) : size

  const sy = w && h ? size * Math.min(1, h / w) : size

  const geo = new THREE.PlaneGeometry(sx, sy)

  const mat = new THREE.MeshBasicMaterial(
    matParams({
      map: masked ?? photo ?? glowTex,
      color: photo ? SF_COLORS.SUN_LIGHT : def.color,
      transparent: true,
      blending: photo ? THREE.NormalBlending : THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  )

  const mesh = new THREE.Mesh(geo, mat)

  mesh.rotation.x = -Math.PI / 2 + (localTilt ?? def.tilt ?? 0)

  return mesh
}
