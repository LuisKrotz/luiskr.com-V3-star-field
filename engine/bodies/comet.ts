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
 * Geometry trick: the tail envelopes are camera-facing sprites parented
 * to the body's `center` group, NOT the nucleus mesh — `center` is
 * translated along +x by the conic radius but never rotated, so local
 * +x always points away from the Sun sitting at the pivot origin. The
 * streaming GAS layers are instead tapered open-ended CONES rooted at
 * the nucleus: a true 3D volume reads correctly from every camera
 * angle (a billboard gas sprite drew its rectangular frame edge-on),
 * and a vertex-color axial fade dissolves the tip into space with no
 * hard rim. updateFx rescales length/width/opacity as `r` swings
 * between periapsis and apoapsis, scrolls `map.offset.y` along the
 * cone axis so filaments stream anti-sunward, and spins `rotation.x`
 * for axial swirl — sublimation scales steeply with solar flux, so
 * the tail grows toward periapsis and all but vanishes outbound.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_COMET } from '@core/tokens/starfield/params.js'
import { matParams } from '../materials.js'
import { lcg, seedFrom } from '../rand.js'
import { texCanvas } from './procedural/shared.js'
import { irregularGeometry } from './primitives.js'
import { surfaceFor } from './procedural.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

/** Tail gradient canvas — long narrow streak, alpha fades along +x. */
const TAIL_W = 256
const TAIL_H = 32

/**
 * Paints the streaming-gas cone texture: a doubly TILEABLE filament
 * field — `wrapT = RepeatWrapping` so updateFx can roll `map.offset.y`
 * and gas visibly streams along the cone axis anti-sunward like plasma
 * riding the solar wind, while `wrapS` repeats it seamlessly around the
 * circumference. Both seams are guaranteed analytically: every wisp
 * follows `x(y) = mid + sin(2π·cycles·y/H + φ)·amp` with an INTEGER
 * cycle count, so its phase at the bottom edge equals the top edge;
 * strokes and knot clumps are each redrawn at `x ± W` / `y ± H` so
 * anything straddling a seam wraps to the far edge.
 * @param THREE The three.js module.
 * @param seed Deterministic RNG stream (seeded per tail so the ion and
 *   dust cones stream different filament patterns).
 * @returns A tileable CanvasTexture, or undefined without a 2d context.
 */
function gasFor(THREE: ThreeModule, seed: () => number): THREE_NS.Texture | undefined {
  const c = texCanvas(SF_COMET.GAS_W, SF_COMET.GAS_H)

  if (!c) return undefined

  const { ctx, canvas } = c
  const W = SF_COMET.GAS_W
  const H = SF_COMET.GAS_H

  ctx.clearRect(0, 0, W, H)

  /**
   * Filaments — thin sinuous rays running the tail's length (vertical
   * in canvas space: the cone's v axis runs root→tip). Integer
   * `cycles` keeps the sine periodic across the canvas height so the
   * v wrap seam is invisible; each streak is redrawn at `x ± W` so a
   * filament hugging the u seam continues around the circumference.
   * Alpha jitters per streak so the shell reads as braided streamers,
   * not one uniform smear.
   */
  for (let i = 0; i < SF_COMET.FILAMENTS; i++) {
    const mid = (0.08 + 0.84 * seed()) * W
    const amp = seed() * SF_COMET.WANDER * W
    const cycles = 1 + Math.floor(seed() * 4)
    const phase = seed() * Math.PI * 2
    const alpha = SF_COMET.FILAMENT_W * (0.35 + 0.65 * seed())

    ctx.strokeStyle = `rgba(255,255,255,${alpha})`
    ctx.lineWidth = 1 + seed() * 1.5

    for (const ox of [0, -W, W]) {
      ctx.beginPath()

      for (let y = 0; y <= H; y += 4) {
        const x = mid + ox + Math.sin((y / H) * Math.PI * 2 * cycles + phase) * amp

        if (y === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }

      ctx.stroke()
    }
  }

  /**
   * Knots — denser gas clumps the outgassing vents throw. Painted at
   * all `x ± W` / `y ± H` offsets so a blob crossing either wrap seam
   * shows its continuation on the far edge.
   */
  for (let i = 0; i < SF_COMET.KNOTS; i++) {
    const kx = seed() * W
    const ky = (0.2 + 0.6 * seed()) * H
    const kr = (0.3 + 0.7 * seed()) * SF_COMET.KNOT_R * H
    const ka = SF_COMET.KNOT_W * (0.4 + 0.6 * seed())

    for (const ox of [0, -W, W]) {
      for (const oy of [0, -H, H]) {
        const g = ctx.createRadialGradient(kx + ox, ky + oy, 0, kx + ox, ky + oy, kr)

        g.addColorStop(0, `rgba(255,255,255,${ka})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')

        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(kx + ox, ky + oy, kr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace
  out.wrapS = THREE.RepeatWrapping
  out.wrapT = THREE.RepeatWrapping

  return out
}

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
 * @returns `{ mesh, coma, ion, dust, ionGas, dustGas }` — the pickable
 *   nucleus group plus the sprites the caller attaches and records on
 *   `node.comet` (the gas layers are the streaming-filament sprites
 *   updateFx scrolls).
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
  ionGas: THREE_NS.Object3D
  dustGas: THREE_NS.Object3D
} {
  const rand = lcg(seedFrom(`${def.id}:comet`))
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

  /**
   * Gas layer — a tapered open-ended CONE instead of a billboard sprite
   * (the sprite's rectangular frame showed edge-on as a square). The
   * unit cylinder is rotated so +y→+x and scales to (len, w, w): the
   * narrow `GAS_ROOT` mouth sits on the nucleus, the wide `GAS_TIP`
   * dissolves anti-sunward. Per-vertex colors carry the axial fade —
   * `b = min(1, 3.5t)·(1−t)^1.3` ramps up just past the root (the cone
   * mouth would otherwise show a hard ring where it pierces the coma)
   * then decays to black at the tip, which reads as transparency under
   * additive blending. updateFx streams `map.offset.y` so filaments
   * flow along the axis and spins `rotation.x` for axial swirl; `tilt`
   * fans the dust cone off the ion line.
   */
  const gasCone = (color: number, opacity: number, tilt: number): THREE_NS.Object3D => {
    const geo = new THREE.CylinderGeometry(
      SF_COMET.GAS_TIP,
      SF_COMET.GAS_ROOT,
      1,
      SF_COMET.GAS_SEG,
      SF_COMET.GAS_ROWS,
      true
    )

    geo.rotateZ(-Math.PI / 2)

    // Axial brightness ramp — written into a per-vertex color attribute
    // that multiplies the filament map, so the tail tip fades into
    // space regardless of what the texture wraps there.
    const pos = geo.attributes.position
    const col = new Float32Array(pos.count * 3)

    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) + 0.5
      const b = Math.min(1, t * 3.5) * Math.pow(1 - t, 1.3)

      col[i * 3] = b
      col[i * 3 + 1] = b
      col[i * 3 + 2] = b
    }

    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

    const cone = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial(
        matParams({
          map: gasFor(THREE, rand) ?? glowTex,
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          vertexColors: true,
          side: THREE.DoubleSide,
        })
      )
    )

    // Center sits at half the (unit) length along the streak direction —
    // updateFx rescales `len` and re-anchors the same offset each frame.
    cone.position.set(Math.cos(tilt) * 0.5, Math.sin(tilt) * 0.5, 0)

    // The dust cone's lag lives on rotation.z — tilting the MESH (not
    // a UV rotation) swings the whole volume off the anti-sunward line.
    cone.rotation.z = tilt

    cone.raycast = () => undefined

    return cone
  }

  const ionGas = gasCone(SF_COLORS.COMET_ION, SF_COMET.ION_OPACITY * SF_COMET.GAS_ALPHA_ION, 0)

  const dustGas = gasCone(
    SF_COLORS.COMET_DUST,
    SF_COMET.DUST_OPACITY * SF_COMET.GAS_ALPHA_DUST,
    SF_COMET.DUST_TILT
  )

  return { mesh, coma, ion, dust, ionGas, dustGas }
}
