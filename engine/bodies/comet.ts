/**
 * @file engine/bodies/comet.ts
 * @description Comet builder — a `SF_KINDS.COMET` body is a dark
 * irregular nucleus wrapped in a sublimated gas envelope (coma) that
 * streams two tails anti-sunward: a thin, straight, blue-white ion
 * tail (plasma entrained by the solar wind's field lines, pointing
 * exactly along the radius vector) and a broader, shorter, lagging
 * dust tail (grains keep some orbital momentum, so the streak fans a
 * few degrees off the anti-sunward line — `SF_COMET.DUST_TILT`).
 *
 * Geometry trick: the tails are camera-facing sprites parented to the
 * body's `center` group, NOT the nucleus mesh — `center` is translated
 * along +x by the conic radius but never rotated, so local +x always
 * points away from the Sun sitting at the pivot origin. A static +x
 * streak is therefore anti-sunward by construction at every orbital
 * phase, with zero per-frame orientation math. updateFx only rescales
 * length/opacity as `r` swings between periapsis and apoapsis —
 * sublimation scales steeply with solar flux, so the tail grows toward
 * periapsis and all but vanishes at the far end of the ellipse.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_COMET } from '@core/tokens/starfield/params.js'
import { matParams } from '../materials.js'
import { texCanvas } from './procedural/shared.js'
import { irregularGeometry } from './primitives.js'
import { surfaceFor } from './procedural.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

/** Tail gradient canvas — long narrow streak, alpha fades along +x. */
const TAIL_W = 256
const TAIL_H = 32

/**
 * Paints the shared tail sprite texture: a horizontal gradient that is
 * brightest at the left edge (the end rooted at the nucleus) and fades
 * smoothly to nothing on the right (the tip dissolving into space),
 * with a vertical cosine falloff so the streak is a soft spindle, not
 * a hard-edged ribbon. White-only — the SpriteMaterial `color` supplies
 * the ion/dust tint so one texture serves both tails.
 * @param THREE The three.js module.
 * @returns A CanvasTexture, or undefined without a 2d context.
 */
function tailFor(THREE: ThreeModule): THREE_NS.Texture | undefined {
  const c = texCanvas(TAIL_W, TAIL_H)

  if (!c) return undefined

  const { ctx, canvas } = c

  ctx.clearRect(0, 0, TAIL_W, TAIL_H)

  // Left→right fade — bright root at the nucleus, dissolving tip.
  const g = ctx.createLinearGradient(0, 0, TAIL_W, 0)

  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = g
  ctx.fillRect(0, 0, TAIL_W, TAIL_H)

  // Vertical taper — multiply a top/bottom roll-off into the alpha so
  // the streak narrows toward the tip like a real dust fan.
  const v = ctx.createLinearGradient(0, 0, 0, TAIL_H)

  v.addColorStop(0, 'rgba(0,0,0,1)')
  v.addColorStop(0.5, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,1)')

  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = v
  ctx.fillRect(0, 0, TAIL_W, TAIL_H)

  ctx.globalCompositeOperation = 'source-over'

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}

/**
 * Builds the comet composite: an irregular, nearly-black nucleus (the
 * real Halley albedo is ~0.04 — one of the darkest known bodies), a
 * soft additive coma sprite hugging it, and the ion + dust tail
 * sprites. The nucleus mesh becomes the node's `mesh`/`spinner` so it
 * tumbles normally; coma rides inside it (a symmetric billboard is
 * indifferent to spin); the tails mount on `center` where local +x is
 * permanently anti-sunward.
 * @param THREE The three.js module.
 * @param def Catalog entry — `radius` sizes the nucleus; `ecc`/`orbit`
 *   drive the periapsis→apoapsis tail scaling in updateFx.
 * @param texMap Loaded texture map (a comet with a real nucleus map
 *   uses it; Halley falls back to the seeded dark-ice surface).
 * @param glowTex Shared radial-glow texture for the coma sprite.
 * @returns `{ mesh, coma, ion, dust }` — the pickable nucleus group
 *   plus the sprites the caller attaches and records on `node.comet`.
 */
export function makeComet(
  THREE: ThreeModule,
  def: SFBodyDef,
  texMap: Map<string, THREE_NS.Texture>,
  glowTex: THREE_NS.Texture | undefined
): {
  mesh: THREE_NS.Object3D
  coma: THREE_NS.Object3D
  ion: THREE_NS.Object3D
  dust: THREE_NS.Object3D
} {
  const geo = irregularGeometry(THREE, def)

  // The nucleus is much darker than the body's display color — Halley's
  // 0.04-albedo crust would read as a fuzzy white ball under the chart
  // lighting if the coma tint were used for the surface, so surfaceFor
  // runs on a nucleus-shaded clone of the def.
  const mat = new THREE.MeshStandardMaterial(
    matParams({
      map:
        texMap.get(def.texture ?? '') ??
        surfaceFor(THREE, { ...def, color: SF_COLORS.COMET_NUCLEUS }),
      color: SF_COLORS.COMET_NUCLEUS,
    })
  )

  const nucleus = new THREE.Mesh(geo, mat)

  const mesh = new THREE.Group()

  mesh.add(nucleus)

  const tailTex = tailFor(THREE)

  // Coma — the sublimated gas envelope: a soft additive glow a few
  // radii wide hugging the nucleus.
  const coma = new THREE.Sprite(
    new THREE.SpriteMaterial(
      matParams({
        map: glowTex,
        color: def.color ?? SF_COLORS.HALLEY,
        transparent: true,
        opacity: SF_COMET.COMA_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  )

  const comaSize = def.radius * SF_COMET.COMA_SCALE

  coma.scale.set(comaSize, comaSize, 1)

  coma.raycast = () => undefined

  mesh.add(coma)

  /**
   * One tail sprite — camera-facing, so the streak reads from every
   * angle. Its center sits at `len/2` along +x so the texture's bright
   * root edge lands on the nucleus and the fade runs anti-sunward.
   * `tilt` swings the sprite's origin off the ecliptic plane so the
   * dust fan visibly lags the ion streak.
   */
  const tailSprite = (
    len: number,
    w: number,
    color: number,
    opacity: number,
    tilt: number
  ): THREE_NS.Sprite => {
    const m = new THREE.SpriteMaterial(
      matParams({
        map: tailTex ?? glowTex,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        rotation: tilt,
      })
    )

    const spr = new THREE.Sprite(m)

    spr.position.set(Math.cos(tilt) * len * 0.5, Math.sin(tilt) * len * 0.5, 0)

    spr.scale.set(len, w, 1)

    spr.raycast = () => undefined

    return spr
  }

  const ion = tailSprite(
    def.radius * SF_COMET.ION_LEN,
    def.radius * SF_COMET.ION_W,
    SF_COLORS.COMET_ION,
    SF_COMET.ION_OPACITY,
    0
  )

  const dust = tailSprite(
    def.radius * SF_COMET.DUST_LEN,
    def.radius * SF_COMET.DUST_W,
    SF_COLORS.COMET_DUST,
    SF_COMET.DUST_OPACITY,
    SF_COMET.DUST_TILT
  )

  return { mesh, coma, ion, dust }
}
