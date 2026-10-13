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
 * Each vent owns two objects: a steady `jet` cone rooted at the surface
 * (an open tapered cylinder carrying a vertical alpha gradient — real
 * 3D geometry so the column reads as a jet from every azimuth instead
 * of a round billboard blob) and a `puff` sprite that cycles outward
 * along the vent axis — spawn at the vent, rise, expand, fade, recycle.
 * updateFx advances the phase and gates each vent by the local sun
 * direction (`vent.sunDir`) so night-side vents smudge instead of
 * glowing — jets scatter sunlight. Nothing allocates per frame, so
 * plumed bodies stay pool-safe like the meteor system.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_PLUME } from '@core/tokens/starfield/params.js'
import { matParams } from '../materials.js'
import { lcg, seedFrom } from '../rand.js'
import { texCanvas } from './procedural/shared.js'
import type { SFBodyDef, SFNode } from '../types.js'

type ThreeModule = typeof import('three')

/** Sprite record the caller lifts onto `node.plumes` for updateFx. */
export type SFPlumeVents = NonNullable<SFNode['plumes']>

/** Jet-gradient canvas — tall narrow strip, alpha runs vertically. */
const JET_W = 32
const JET_H = 128

/**
 * Paints the shared jet-column texture: a vertical alpha ramp blazing
 * at the vent (the cylinder's bottom edge samples the canvas bottom —
 * CylinderGeometry maps v=0 to the base) that dissolves through the
 * umbrella into nothing at the rim, with a horizontal cosine roll-off
 * softening the silhouette edges. White-only — the material `color`
 * supplies the ice/sulfur tint so one texture serves every vent.
 * @param THREE The three.js module.
 * @returns A CanvasTexture, or undefined without a 2d context.
 */
function jetFor(THREE: ThreeModule): THREE_NS.Texture | undefined {
  const c = texCanvas(JET_W, JET_H)

  if (!c) return undefined

  const { ctx, canvas } = c

  ctx.clearRect(0, 0, JET_W, JET_H)

  // Bottom→top fade — incandescent throat, evaporating umbrella.
  const g = ctx.createLinearGradient(0, JET_H, 0, 0)

  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = g
  ctx.fillRect(0, 0, JET_W, JET_H)

  // Horizontal roll-off — cylinder sides fade so the silhouette is soft.
  const h = ctx.createLinearGradient(0, 0, JET_W, 0)

  h.addColorStop(0, 'rgba(0,0,0,1)')
  h.addColorStop(0.5, 'rgba(0,0,0,0)')
  h.addColorStop(1, 'rgba(0,0,0,1)')

  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = h
  ctx.fillRect(0, 0, JET_W, JET_H)

  ctx.globalCompositeOperation = 'source-over'

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}

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

  const jetTex = jetFor(THREE)
  const vents: SFPlumeVents = []
  const up = new THREE.Vector3(0, 1, 0)

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

    // Steady jet — a tapered open cylinder: narrow at the throat
    // (JET_BASE_W), umbrella-wide at altitude (JET_TOP_W) like the real
    // ballistic fountain. `translate` roots the base at the origin so a
    // quaternion swing onto `dir` plants the throat exactly on the vent.
    const jetGeo = new THREE.CylinderGeometry(
      def.radius * SF_PLUME.JET_TOP_W,
      def.radius * SF_PLUME.JET_BASE_W,
      height,
      SF_PLUME.JET_SEG,
      1,
      true
    )

    jetGeo.translate(0, height * 0.5, 0)

    const jet = new THREE.Mesh(
      jetGeo,
      new THREE.MeshBasicMaterial(
        matParams({
          map: jetTex ?? glowTex,
          color,
          transparent: true,
          opacity: SF_PLUME.OPACITY,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      )
    )

    jet.quaternion.setFromUnitVectors(up, new THREE.Vector3(dir.x, dir.y, dir.z))

    jet.position.set(
      dir.x * def.radius * 0.97,
      dir.y * def.radius * 0.97,
      dir.z * def.radius * 0.97
    )

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
