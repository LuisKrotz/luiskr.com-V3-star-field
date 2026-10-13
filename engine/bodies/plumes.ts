/**
 * @file engine/bodies/plumes.ts
 * @description Cryovolcanic and volcanic plume systems — the moving
 * ejecta that makes Enceladus and Io read as active worlds instead of
 * static spheres.
 *
 *   Enceladus (`plumes.polar`) — vents cluster around the south pole,
 *   the tiger-stripe fractures that vent water-ice grains into space
 *   (the plumes feed Saturn's E ring). `POLAR_LAT` gates the unit-sphere
 *   band and `POLAR_SPREAD` scatters the vents inside it.
 *   Io (`polar` unset) — volcanic vents sample the whole sphere; the
 *   sulfur-tinted jets umbrella outward like the real Prometheus/Pele
 *   plumes imaged by Voyager/Galileo.
 *
 * Each vent owns two sprites: a steady `jet` rooted at the surface
 * (a stretched glow billboard shimmering in place) and a `puff` that
 * cycles outward along the vent axis — spawn at the vent, rise, expand,
 * fade, recycle. updateFx advances the phase; nothing allocates per
 * frame, so plumed bodies stay pool-safe like the meteor system.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_PLUME } from '@core/tokens/starfield/params.js'
import { matParams } from '../materials.js'
import { lcg, seedFrom } from '../rand.js'
import type { SFBodyDef, SFNode } from '../types.js'

type ThreeModule = typeof import('three')

/** Sprite record the caller lifts onto `node.plumes` for updateFx. */
export type SFPlumeVents = NonNullable<SFNode['plumes']>

/**
 * Builds the plume group for a `def.plumes` body: per-vent jet + puff
 * sprites under one group the caller parents to the body mesh (jets
 * inherit surface spin, so vents stay fixed over their terrain scars —
 * Enceladus' geysers track the tiger stripes as the moon rotates).
 * @param THREE The three.js module.
 * @param def Catalog entry — `plumes` config + radius scale the vents.
 * @param glowTex Shared radial-glow texture for the sprites.
 * @returns `{ group, vents }` — null without a glow texture.
 */
export function makePlumes(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): { group: THREE_NS.Object3D; vents: SFPlumeVents } | null {
  const cfg = def.plumes

  if (!cfg || !glowTex) return null

  const rand = lcg(seedFrom(`${def.id}:plumes`))

  const count = cfg.count ?? SF_PLUME.VENTS
  const color = cfg.color ?? SF_COLORS.PLUME_ICE
  const height = (cfg.height ?? SF_PLUME.HEIGHT) * def.radius
  const width = def.radius * SF_PLUME.WIDTH

  const group = new THREE.Group()

  const vents: SFPlumeVents = []

  for (let i = 0; i < count; i++) {
    // Vent direction — polar vents sit in a narrow band around the
    // south pole (unit-sphere y ≈ −1); scattered vents sample the whole
    // sphere via the uniform-direction trick (u uniform in cos θ).
    let dir: { x: number; y: number; z: number }

    if (cfg.polar) {
      const a = rand() * Math.PI * 2
      const r = rand() * SF_PLUME.POLAR_SPREAD

      dir = { x: Math.cos(a) * r, y: -(1 - rand() * (1 - SF_PLUME.POLAR_LAT)), z: Math.sin(a) * r }

      const il = 1 / Math.hypot(dir.x, dir.y, dir.z)

      dir = { x: dir.x * il, y: dir.y * il, z: dir.z * il }
    } else {
      const u = rand() * 2 - 1
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)

      dir = { x: Math.cos(a) * r, y: u, z: Math.sin(a) * r }
    }

    // Steady jet — a vertical glow streak rooted just off the surface
    // along the vent axis; updateFx shimmers its opacity in place.
    const jet = new THREE.Sprite(
      new THREE.SpriteMaterial(
        matParams({
          map: glowTex,
          color,
          transparent: true,
          opacity: SF_PLUME.OPACITY,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    )

    jet.position.set(
      dir.x * (def.radius + height * 0.25),
      dir.y * (def.radius + height * 0.25),
      dir.z * (def.radius + height * 0.25)
    )

    jet.scale.set(width, height * 0.55, 1)

    jet.raycast = () => undefined

    group.add(jet)

    // Rising puff — cycles outward along the vent axis: spawn compact at
    // the surface, expand and fade through the rise, recycle at the top.
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial(
        matParams({
          map: glowTex,
          color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    )

    puff.position.set(dir.x * def.radius, dir.y * def.radius, dir.z * def.radius)

    puff.scale.set(width, width, 1)

    puff.raycast = () => undefined

    group.add(puff)

    vents.push({
      jet,
      puff,
      dir,
      phase: rand(),
      rate: (0.7 + rand() * 0.6) / SF_PLUME.PERIOD,
      radius: def.radius,
      height,
      width,
    })
  }

  return { group, vents }
}
