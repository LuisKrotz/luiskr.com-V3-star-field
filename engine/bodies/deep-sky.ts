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
import { SF_COLORS, SF_DETAIL, SF_NEBULA_DEPTH } from '@core/tokens/starfield/params.js'
import { maskPhotoTexture, photoSize } from './mask.js'
import { clusterFor, gasFor } from './procedural.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { matParams } from '../materials.js'
import { lcg, seedFrom } from '../rand.js'
import type { SFBodyDef, SFNebulaFx } from '../types.js'

type ThreeModule = typeof import('three')

/** Texture source map shared with bootstrap (URL → loaded texture). */
type TexMap = Map<string, THREE_NS.Texture>

/**
 * userData key under which `makeNebulaSprite` parks the animation
 * record (`SFNebulaFx`) — bodies-scene lifts it onto the node so
 * `updateFx` can swirl/breathe the layers without the sprite factory
 * changing its return contract.
 */
export const SF_USER_NEBULA = 'nebulaFx'

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
  glowTex: THREE_NS.Texture | undefined,
  lobes = 0
): THREE_NS.Sprite {
  const photo = def.texture ? texMap.get(def.texture) : undefined

  const masked = photo ? maskPhotoTexture(THREE, photo, { lobes, seed: def.id }) : undefined

  // No photo → seeded stand-in per body class: globular clusters get a
  // King-profile star swarm (a gas cloud is physically wrong — clusters
  // are bound star balls), nebulae keep the wispy gas lobes. The
  // generated canvas carries its own alpha either way.
  const gas = photo
    ? undefined
    : def.kind === SF_KINDS.CLUSTER
      ? clusterFor(THREE, def)
      : gasFor(THREE, def)

  const mat = new THREE.SpriteMaterial(
    matParams({
      map: masked ?? photo ?? gas ?? glowTex,
      // Untinted when real imagery or generated gas renders — tint only
      // colors the last-ditch glow fallback.
      color: photo || gas ? SF_COLORS.SUN_LIGHT : def.color,
      transparent: true,
      // Additive on every path: a normal-blended photo occludes the
      // star field with its dark sky frame — a flat card. Additive lets
      // background stars shine through the photo's dark regions while
      // its light accumulates, and the feathered mask still melts the
      // rectangular edge (SRC_ALPHA gates the contribution).
      blending: THREE.AdditiveBlending,
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

  // ── Living-gas depth layers ────────────────────────────────────────
  // A single billboard is a static photograph; a nebula is a churning
  // volume. Two extra layers stacked on the sprite fake the parallax
  // shear of gas at different depths: an ECHO — the same imagery
  // ghosted at low opacity, rotated off-axis and counter-rotating —
  // and a wide UNDERLAY glow carrying the body tint as the ambient
  // light-field. updateFx swirls each layer's UV rotation at its own
  // seeded rate and breathes opacity, so the cloud visibly churns.
  const rand = lcg(seedFrom(`${def.id}:nebula`))

  const swirl = SF_NEBULA_DEPTH.SWIRL_MIN + rand() * SF_NEBULA_DEPTH.SWIRL_SPREAD

  const layers: SFNebulaFx['layers'] = [
    {
      material: mat as { rotation: number; opacity: number },
      rate: swirl,
      phase: rand() * Math.PI * 2,
      opBase: 1,
    },
  ]

  const face = masked ?? photo ?? gas

  if (face) {
    const echoMat = new THREE.SpriteMaterial(
      matParams({
        map: face,
        color: SF_COLORS.SUN_LIGHT,
        transparent: true,
        opacity: SF_NEBULA_DEPTH.ECHO_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )

    const echo = new THREE.Sprite(echoMat)

    // Rotated off-axis at rest so the ghost shears against the photo
    // even before the counter-rotation animates.
    echoMat.rotation = Math.PI / 3

    echo.scale.set(SF_NEBULA_DEPTH.ECHO_SCALE, SF_NEBULA_DEPTH.ECHO_SCALE, 1)

    sprite.add(echo)

    layers.push({
      material: echoMat as { rotation: number; opacity: number },
      rate: swirl * SF_NEBULA_DEPTH.ECHO_RATE,
      phase: echoMat.rotation,
      opBase: SF_NEBULA_DEPTH.ECHO_OPACITY,
    })
  }

  if (glowTex) {
    const underMat = new THREE.SpriteMaterial(
      matParams({
        map: glowTex,
        color: def.color ?? SF_COLORS.SUN_LIGHT,
        transparent: true,
        opacity: SF_NEBULA_DEPTH.UNDER_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )

    const under = new THREE.Sprite(underMat)

    under.scale.set(SF_NEBULA_DEPTH.UNDER_SCALE, SF_NEBULA_DEPTH.UNDER_SCALE, 1)

    sprite.add(under)

    layers.push({
      material: underMat as { rotation: number; opacity: number },
      rate: swirl * SF_NEBULA_DEPTH.UNDER_RATE,
      phase: rand() * Math.PI * 2,
      opBase: SF_NEBULA_DEPTH.UNDER_OPACITY,
    })
  }

  sprite.userData[SF_USER_NEBULA] = {
    layers,
    baseScale: { x: sx, y: sy },
    phase: rand() * Math.PI * 2,
  } satisfies SFNebulaFx

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
      // Additive so the photo's dark sky transmits background starlight
      // instead of reading as an opaque tilted card — see nebula sprite.
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  )

  const mesh = new THREE.Mesh(geo, mat)

  mesh.rotation.x = -Math.PI / 2 + (localTilt ?? def.tilt ?? 0)

  return mesh
}
