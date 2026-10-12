/**
 * @file engine/registry-body.ts
 * @description Lazy registry-body spawner — the 139,563-record deep
 * catalog renders as plain cloud points until a record is selected,
 * when this module materializes a real textured object at the record's
 * true heliocentric position on the Sun's pivot:
 *
 *   star-NNNNNN      → fresnel photosphere sphere + spectral tint +
 *                      seeded granulation texture + halo sprite
 *   exoplanet-NNNNNN → lit sphere with a seeded procedural surface
 *                      (mottle/bands/streaks — one texture per record)
 *   dso-NNNNNN       → seeded speckle cloud + glow sprite tinted by
 *                      the OpenNGC type code (galaxy/cluster/nebula)
 *
 * Spawned objects LRU-cache on `s.registryBodies` (cap BODY_CACHE) so a
 * long browsing session materializes detail only for visited records —
 * the catalog stays lazy-loaded end to end. Each group stamps the
 * record's `bodyId` on userData so the pointer pipeline can pick it.
 */
import type * as THREE_NS from 'three'
import {
  SF_BELT,
  SF_BODY_IDS,
  SF_COLORS,
  SF_DETAIL,
  SF_SCENE,
  SF_SPIRAL,
  SF_STAR_CLOUD,
} from '@core/tokens/starfield/params.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { makeGlowSphereMaterial, makeStarHalo } from './bodies/primitives.js'
import { fillElliptical } from './spiral/fill.js'
import { matParams } from './materials.js'
import { starSurfaceFor } from './bodies/procedural/star-surface.js'
import { surfaceFor } from './bodies/procedural/surface.js'
import { lcg, seedFrom } from './rand.js'
import { sfGalacticVec } from './scale.js'
import { SF_USER_BODY } from './bodies/primitives.js'
import type { SFRegistryRecord } from './registry.js'
import type { SFBodyDef, SFState } from './types.js'

type ThreeModule = typeof import('three')

/**
 * Spectral-class → palette tint — the HYG `s` field leads with the
 * Harvard letter (O B A F G K M); a record with no usable class falls
 * back to the white mid-ramp. Colors come from the shared B-V ramp
 * tokens so the spawned star matches the cloud's own color grading.
 */
const _SPECTRAL_TINT: Record<string, number> = {
  O: SF_COLORS.STAR_BLUE,
  B: SF_COLORS.STAR_BLUE,
  A: SF_COLORS.STAR_WHITE,
  F: SF_COLORS.STAR_WHITE,
  G: SF_COLORS.STAR_GOLD,
  K: SF_COLORS.STAR_ORANGE,
  M: SF_COLORS.STAR_RED,
}

/**
 * Exoplanet palettes — seeded pick between a rocky tint and a
 * gas-giant tint; members come from the authored exoplanet palette so
 * spawned worlds sit in the same color space as the catalog's own
 * TRAPPIST/Kepler planets.
 */
const _EXO_TINTS: ReadonlyArray<number> = [
  SF_COLORS.TRAPPIST_PLANET,
  SF_COLORS.KEPLER_PLANET,
  SF_COLORS.EPS_ERI_PLANET,
  SF_COLORS.TAU_CETI_PLANET,
  SF_COLORS.PEGASI_PLANET,
]

/**
 * OpenNGC type-code → tint. `t` carries the catalogue's short type
 * string (G/Gx galaxies, OC/** clusters, PN/RN nebulae, SNR remnants);
 * unmapped codes keep the cloud's own DSO point tint so a spawned
 * object matches the point it replaces.
 */
const _DSO_TINTS: ReadonlyArray<{ match: string[]; color: number }> = [
  { match: ['SNR', 'PN', 'RN', 'Nb', 'EmN'], color: SF_COLORS.ORION_NEBULA },
  { match: ['OC', 'GC', 'Cl', 'GlC', 'OpC'], color: SF_COLORS.PLEIADES },
  { match: ['G', 'Gx', 'IG', 'PaG'], color: SF_COLORS.ANDROMEDA },
]

/**
 * Resolves the spectral tint for a star record — first letter of the
 * Harvard class (`s` = "G2V" → G) through the shared ramp.
 * @param rec Registry record.
 */
function starTint(rec: SFRegistryRecord): number {
  const letter = (rec.s ?? '').trim().charAt(0).toUpperCase()

  return _SPECTRAL_TINT[letter] ?? SF_COLORS.STAR_WHITE
}

/**
 * Resolves the DSO tint by scanning the record's OpenNGC type code
 * against the ordered match table (first hit wins — SNR before G so a
 * remnant never reads as a galaxy).
 * @param rec Registry record.
 */
function dsoTint(rec: SFRegistryRecord): number {
  const t = rec.t ?? ''

  for (const entry of _DSO_TINTS) {
    if (entry.match.some((m) => t.includes(m))) return entry.color
  }

  return SF_COLORS.DSO_PT
}

/**
 * Magnitude → chart radius for a spawned star — real discs scale with
 * luminosity, so a Sirius-class record (mag −1) draws the largest disc
 * the clamps allow while a mag-9 dwarf stays a hard point with a halo.
 * @param m Apparent magnitude (null/absent → mid-curve).
 */
function starRadius(m: number | null | undefined): number {
  const mag = m ?? 6

  return Math.min(
    SF_STAR_CLOUD.BODY_STAR_MAX_R,
    Math.max(
      SF_STAR_CLOUD.BODY_STAR_MIN_R,
      SF_STAR_CLOUD.BODY_STAR_R * Math.pow(10, -mag * SF_STAR_CLOUD.BODY_STAR_MAGK * 0.5)
    )
  )
}

/**
 * Registry star — a fresnel-limb photosphere sphere (same shader the
 * authored stars use) tinted by spectral class with a seeded
 * granulation surface texture, plus the additive halo sprite so the
 * selected star reads as a point source at cloud range.
 * @param THREE The three.js module.
 * @param s Engine state (deps + glowTex).
 * @param rec The registry record.
 */
function buildStar(s: SFState, THREE: ThreeModule, rec: SFRegistryRecord): THREE_NS.Object3D {
  const radius = starRadius(rec.m)

  const def: SFBodyDef = {
    id: rec.i,
    name: rec.n,
    kind: SF_KINDS.STAR,
    group: '',
    radius,
    color: starTint(rec),
    dist: '',
  }

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, SF_SCENE.SPHERE_SEGMENTS, SF_SCENE.SPHERE_SEGMENTS / 2),
    makeGlowSphereMaterial(
      THREE,
      s.deps!,
      def.color,
      starSurfaceFor(THREE, def),
      SF_COLORS.STAR_RIM,
      SF_DETAIL.STAR_RIM_FALLOFF
    )
  )

  mesh.add(makeStarHalo(THREE, def, s.glowTex ?? undefined))

  return mesh
}

/**
 * Registry exoplanet — a lit sphere whose surface is the shared seeded
 * procedural texture (mottle/bands/streaks keyed on the record id), so
 * each of the 5,974 catalogued worlds gets its own terrain instead of
 * the same painted ball. Tint picks seeded from the exoplanet palette.
 * @param THREE The three.js module.
 * @param rec The registry record.
 */
function buildExoplanet(THREE: ThreeModule, rec: SFRegistryRecord): THREE_NS.Object3D {
  const rand = lcg(seedFrom(rec.i))

  const def: SFBodyDef = {
    id: rec.i,
    name: rec.n,
    kind: SF_KINDS.PLANET,
    group: '',
    radius: SF_STAR_CLOUD.BODY_PLANET_R,
    color: _EXO_TINTS[Math.floor(rand() * _EXO_TINTS.length)],
    dist: '',
  }

  return new THREE.Mesh(
    new THREE.SphereGeometry(def.radius, SF_SCENE.SPHERE_SEGMENTS, SF_SCENE.SPHERE_SEGMENTS / 2),
    new THREE.MeshStandardMaterial(matParams({ map: surfaceFor(THREE, def), color: def.color }))
  )
}

/**
 * Registry deep-sky object — a seeded elliptical speckle cloud (the
 * same `fillElliptical` the authored dwarf galaxies use, so a catalog
 * galaxy/cluster resolves as a resolved member swarm, not a billboard)
 * plus an additive halo sprite tinted by the OpenNGC type code.
 * @param THREE The three.js module.
 * @param s Engine state (glowTex).
 * @param rec The registry record.
 */
function buildDso(s: SFState, THREE: ThreeModule, rec: SFRegistryRecord): THREE_NS.Object3D {
  const group = new THREE.Group()

  const radius = SF_STAR_CLOUD.BODY_DSO_R

  const count = SF_STAR_CLOUD.BODY_DSO_SPECKLES

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  const tintC = new THREE.Color(dsoTint(rec))

  fillElliptical(pos, col, radius, seedFrom(rec.i), count, [tintC.r, tintC.g, tintC.b])

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial(
      matParams({
        size: SF_SPIRAL.POINT_PX,
        map: s.glowTex,
        vertexColors: true,
        transparent: true,
        opacity: SF_BELT.OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    )
  )

  // Speckles stay un-pickable — the whole group answers raycasts via
  // the parent group's bodyId path (picking prefers real meshes anyway).
  points.raycast = () => undefined

  group.add(points)

  const def: SFBodyDef = {
    id: rec.i,
    name: rec.n,
    kind: SF_KINDS.NEBULA,
    group: '',
    radius,
    color: dsoTint(rec),
    dist: '',
  }

  group.add(makeStarHalo(THREE, def, s.glowTex ?? undefined, true))

  return group
}

/**
 * Disposes every geometry/material/owned texture under a spawned
 * registry group — canvas-generated textures (procedural surfaces) are
 * theirs to release; the shared `glowTex` sprite is excluded so
 * eviction never corrupts the scene's shared sprite.
 * @param s Engine state (shared glowTex to exclude).
 * @param root The spawned group to strip.
 */
function disposeRegistryTree(s: SFState, root: THREE_NS.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE_NS.Mesh

    m.geometry?.dispose?.()

    const mat = (m as unknown as { material?: THREE_NS.Material }).material

    if (!mat) return

    const map = (mat as unknown as { map?: THREE_NS.Texture }).map

    if (map && map !== s.glowTex) map.dispose?.()

    mat.dispose?.()
  })

  root.parent?.remove(root)
}

/**
 * Materializes the rendered body for a catalog record at its true
 * heliocentric chart position — the object the cloud point stands in
 * for. LRU-cached on `s.registryBodies`; a cache overflow evicts and
 * disposes the oldest spawn so mesh count stays bounded. No-ops on
 * missing THREE/deps (pre-boot), missing Sun pivot, or dispose.
 * @param s Engine state.
 * @param rec The resolved registry record.
 */
export function ensureRegistryBody(s: SFState, rec: SFRegistryRecord): void {
  const THREE = s.THREE
  const deps = s.deps

  if (!THREE || !deps || s.disposed) return

  // LRU touch — re-selecting a cached body keeps it hot.
  const cached = s.registryBodies.get(rec.i)

  if (cached) {
    s.registryBodies.delete(rec.i)
    s.registryBodies.set(rec.i, cached)

    return
  }

  const sun = s.nodes.get(SF_BODY_IDS.SUN)

  const mw = s.nodes.get(SF_BODY_IDS.MILKY_WAY)?.def

  if (!sun?.pivot || !mw) return

  const body = rec.i.startsWith('star-')
    ? buildStar(s, THREE, rec)
    : rec.i.startsWith('exoplanet-')
      ? buildExoplanet(THREE, rec)
      : buildDso(s, THREE, rec)

  body.userData[SF_USER_BODY] = rec.i

  // Same heliocentric frame the deep-field cloud decodes into — the
  // body lands exactly on its catalogued point.
  const [x, y, z] = sfGalacticVec(rec.x, rec.y, rec.z, mw.tilt ?? 0)

  body.position.set(x, y, z)

  sun.pivot.add(body)

  s.registryBodies.set(rec.i, body)

  // LRU eviction — Map insertion order is the access order (hits are
  // re-set), so the first entry is always the stalest spawn; deleting
  // the current entry mid-iteration is safe and `break` bounds the
  // pass to one eviction per loop turn.
  while (s.registryBodies.size > SF_STAR_CLOUD.BODY_CACHE) {
    for (const [id, dead] of s.registryBodies) {
      s.registryBodies.delete(id)

      disposeRegistryTree(s, dead)

      break
    }
  }
}

/**
 * Strips every spawned registry body — engine teardown and any
 * context-loss path call this so the LRU set can't leak GPU buffers.
 * @param s Engine state.
 */
export function disposeRegistryBodies(s: SFState): void {
  for (const [, body] of s.registryBodies) {
    disposeRegistryTree(s, body)
  }

  s.registryBodies.clear()
}
