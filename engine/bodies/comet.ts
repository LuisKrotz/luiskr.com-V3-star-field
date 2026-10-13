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
 * The tails are PARTICLE FIELDS, not geometry or billboards: each tail
 * is two `THREE.Points` layers (a dense bright core stream plus a wide
 * dim sheath) whose particles are camera-facing soft-glow sprites —
 * the tail's silhouette is always a union of round soft blobs, so no
 * quad edge can ever render as a line, rectangle or cone. Particles
 * follow an emission cycle `d = frac(phase + t·rate)`: `x = d·len`
 * carries each grain anti-sunward, its lateral offset fans out with
 * distance (solar-wind dispersion spreads the column), and vertex
 * colors carry the per-particle brightness — additive blending turns
 * dim color into transparency, so the tail dissolves grain-by-grain
 * into a ragged, diffuse tip instead of a cut edge.
 *
 * Geometry trick: the tails are parented to the body's `center` group,
 * NOT the tumbling nucleus — `center` is translated along +x by the
 * conic radius but never rotated, so local +x always points away from
 * the Sun sitting at the pivot origin. updateFx only rewrites the
 * particle positions/colors as `r` swings between periapsis and
 * apoapsis — sublimation scales steeply with solar flux, so the tail
 * ignites toward periapsis and all but vanishes at the far end of the
 * ellipse.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_COMET } from '@core/tokens/starfield/params.js'
import { matParams } from '../materials.js'
import { lcg, seedFrom } from '../rand.js'
import { irregularGeometry } from './primitives.js'
import { surfaceFor } from './procedural.js'
import type { SFBodyDef } from '../types.js'

type ThreeModule = typeof import('three')

/**
 * userData key each tail `InstancedMesh` node uses to stash its particle
 * simulation record: the live position/color `Float32Array`s, the
 * instance-buffer handles (`aMat` = `instanceMatrix`, `aCol` =
 * `instanceColor` — so updateFx can flag `needsUpdate`), the seeded
 * per-grain vectors (emission phase, lateral offset, stream rate,
 * wobble, size jitter), and the layer's base dimensions (tail length,
 * root spread, fan growth, grain size, tint, opacity). Storing the
 * arrays here — rather than reading them back out of buffers — keeps
 * the frame loop allocation-free AND makes the record inspectable
 * without a live three.js renderer.
 */
export const SF_USER_GAS = 'gasPts'

/**
 * Builds ONE comet-tail particle layer: an `InstancedMesh` of `n`
 * billboarded glow quads plus the simulation record updateFx animates.
 * Each grain i cycles `d = frac(phase[i] + t·rate[i])` — d=0 is fresh
 * emission hugging the nucleus, d=1 is fully dispersed — and updateFx
 * maps it to `x = d·len` anti-sunward with a lateral offset
 * `lat[i]·spread·(1+grow·d)` (the tail widens downstream as solar-wind
 * pressure disperses it) plus a seeded sinusoidal wobble (plasma
 * turbulence) and a z-offset (real depth — the sheet reads volumetric,
 * not painted). Per-grain brightness `dim[i]·envelope(d)` rides in the
 * instance-color channel: the `ramp` smoothstep keeps the root from
 * popping in as a wall, and the `(1−d)^fade` decay makes every grain
 * die at its own distance — the aggregate tip is a ragged dissolve,
 * never a straight line.
 *
 * Why instanced quads and not `THREE.Points`: under the WebGPU node
 * pipeline `PointsMaterial.size` is not honored the way WebGL's
 * `gl_PointSize` is — grains rasterize at a pixel or two regardless of
 * the requested world size, so a real volumetric tail renders as
 * confetti. An InstancedMesh of unit quads — one draw call for the
 * whole cloud, each instance matrix billboarded onto the camera
 * orientation per frame — keeps real world-space size, the soft glow
 * texture, and per-grain HDR color on every renderer.
 * @param THREE The three.js module.
 * @param rand Seeded RNG stream (per-tail, so ion and dust churn on
 *   different grain patterns).
 * @param glowTex Shared radial-glow texture — each grain sprites a soft
 *   round blob, which is what makes the silhouette edgeless.
 * @param color Tail tint (ion blue-white / warm dust) as a hex number —
 *   decomposed into `rgb` so updateFx can scale it per grain without
 *   per-frame `Color` allocation.
 * @param len Resting tail length (world units — × nucleus radius).
 * @param spread Resting half-width at the root; grows by `grow × d`
 *   toward the tip.
 * @param n Grain count.
 * @param size Grain diameter (world units — the quad's instance scale;
 *   grains swell downstream via `SF_COMET.SZ_GROW`).
 * @param opacity Base layer opacity — updateFx multiplies it by the
 *   periapsis activity factor.
 * @param rateLo Per-grain emission-cycle rate range (cycles/scene
 *   second) — the ion wind streams fast, dust drifts.
 * @param rateHi Upper bound of that range.
 * @param tilt Lag angle (rad) — the whole node rotates about z so the
 *   dust fan trails the anti-sunward line; 0 for the ion stream.
 * @returns An `InstancedMesh` node carrying `SF_USER_GAS`.
 */
function tailLayer(
  THREE: ThreeModule,
  rand: () => number,
  glowTex: THREE_NS.Texture | undefined,
  color: number,
  len: number,
  spread: number,
  grow: number,
  n: number,
  size: number,
  opacity: number,
  rateLo: number,
  rateHi: number,
  tilt: number
): THREE_NS.InstancedMesh {
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)

  const phase = new Float32Array(n)
  const lat = new Float32Array(n)
  const latZ = new Float32Array(n)
  const rate = new Float32Array(n)
  const wobP = new Float32Array(n)
  const wobA = new Float32Array(n)
  const wobF = new Float32Array(n)
  const dim = new Float32Array(n)
  const sz = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    phase[i] = rand()

    /**
     * Pseudo-normal lateral offset — the mean of three uniforms
     * concentrates density on the spine while still filling a diffuse
     * sheath, so the column is denser down its axis like a real tail
     * (a flat [-1,1] draw would smear the brightness evenly).
     */
    lat[i] = (rand() + rand() + rand()) / 1.5 - 1
    latZ[i] = (rand() + rand() + rand()) / 1.5 - 1

    rate[i] = rateLo + (rateHi - rateLo) * rand()

    wobP[i] = rand() * Math.PI * 2
    wobA[i] = rand()
    wobF[i] = SF_COMET.WOBF_LO + (SF_COMET.WOBF_HI - SF_COMET.WOBF_LO) * rand()

    dim[i] = SF_COMET.DIM_LO + (1 - SF_COMET.DIM_LO) * rand()
    sz[i] = SF_COMET.SZ_LO + (1 - SF_COMET.SZ_LO) * rand()
  }

  /**
   * Unit quad instanced per grain — instance color carries the
   * grain's brightness (`MeshBasicMaterial` multiplies the map by
   * `instanceColor`, and additive blending turns dim color into
   * transparency, so per-grain fade needs no shader). The buffers are
   * DynamicDraw — updateFx rewrites both every frame.
   */
  const quad = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial(
    matParams({
      map: glowTex,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  )
  const pts = new THREE.InstancedMesh(quad, mat, n)
  const aCol = new THREE.InstancedBufferAttribute(col, 3)

  pts.instanceColor = aCol

  pts.instanceMatrix?.setUsage?.(THREE.DynamicDrawUsage)
  aCol.setUsage?.(THREE.DynamicDrawUsage)

  // The grains stream across the whole tail — the bounding volume can
  // never be static, so culling is off rather than recomputed per frame.
  pts.frustumCulled = false
  pts.rotation.z = tilt
  pts.raycast = () => undefined

  /**
   * `rgb` is the layer tint decomposed to floats — updateFx writes
   * `col[i] = rgb·env(i,d)` per frame without allocating a `Color`;
   * `aMat`/`aCol` alias the instance buffers so `needsUpdate` reaches
   * the GPU side without touching geometry internals.
   */
  pts.userData[SF_USER_GAS] = {
    pos,
    col,
    aMat: pts.instanceMatrix,
    aCol,
    phase,
    lat,
    latZ,
    rate,
    wobP,
    wobA,
    wobF,
    dim,
    sz,
    psize: size,
    len,
    spread,
    grow,
    rgb: [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255],
    op: opacity,
  }

  return pts
}

/**
 * Builds the comet composite: an irregular, nearly-black nucleus (the
 * real Halley albedo is ~0.04 — one of the darkest known bodies), a
 * soft additive coma sprite hugging it, and the ion + dust particle
 * tails. The nucleus mesh becomes the node's `mesh`/`spinner` so it
 * tumbles normally; coma rides inside it (a symmetric billboard is
 * indifferent to spin); the tails mount on `center` where local +x is
 * permanently anti-sunward. Each tail is two particle layers — a tight
 * bright core stream and a wide dim sheath — so the column reads as a
 * volume of gas with a dense spine, not a painted band.
 * @param THREE The three.js module.
 * @param def Catalog entry — `radius` sizes the nucleus AND every tail
 *   dimension (length, spread, grain size all scale off it);
 *   `ecc`/`orbit` drive the periapsis→apoapsis gating in updateFx.
 * @param texMap Loaded texture map (a comet with a real nucleus map
 *   uses it; Halley falls back to the seeded dark-ice surface).
 * @param glowTex Shared radial-glow texture — used for the coma sprite
 *   AND as each tail particle's soft round map.
 * @returns `{ mesh, coma, ion, dust, ionGas, dustGas }` — the pickable
 *   nucleus group, the coma sprite, and the four `Points` tail layers
 *   the caller mounts on `center` and records on `node.comet`
 *   (ion/ionGas = core+sheath of the ion stream; dust/dustGas likewise).
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

  const r = def.radius

  /**
   * Ion tail — long, narrow, fast-streaming plasma column. Two layers:
   * the core grains are small/bright (the dense spine) and the sheath
   * grains are large/dim (the diffuse gas envelope the spine rides in).
   */
  const ion = tailLayer(
    THREE,
    rand,
    glowTex,
    SF_COLORS.COMET_ION,
    r * SF_COMET.ION_LEN,
    r * SF_COMET.SPREAD_ION,
    SF_COMET.GROW_ION,
    SF_COMET.PTS_CORE,
    r * SF_COMET.PSZ_CORE,
    SF_COMET.ION_OPACITY,
    SF_COMET.RATE_ION_LO,
    SF_COMET.RATE_ION_HI,
    0
  )

  const ionGas = tailLayer(
    THREE,
    rand,
    glowTex,
    SF_COLORS.COMET_ION,
    r * SF_COMET.ION_LEN,
    r * SF_COMET.SPREAD_ION * SF_COMET.SHEATH_W,
    SF_COMET.GROW_ION,
    SF_COMET.PTS_HALO,
    r * SF_COMET.PSZ_HALO,
    SF_COMET.ION_OPACITY * SF_COMET.OP_HALO,
    SF_COMET.RATE_ION_LO * SF_COMET.HALO_SLOW,
    SF_COMET.RATE_ION_HI * SF_COMET.HALO_SLOW,
    0
  )

  /**
   * Dust tail — shorter, broader, slower: grains retain orbital
   * momentum so the fan trails the radius vector (the `DUST_TILT` lag)
   * and disperses wider than the magnetically-locked ion stream.
   */
  const dust = tailLayer(
    THREE,
    rand,
    glowTex,
    SF_COLORS.COMET_DUST,
    r * SF_COMET.DUST_LEN,
    r * SF_COMET.SPREAD_DUST,
    SF_COMET.GROW_DUST,
    SF_COMET.PTS_CORE,
    r * SF_COMET.PSZ_CORE * SF_COMET.DUST_PSIZE,
    SF_COMET.DUST_OPACITY,
    SF_COMET.RATE_DUST_LO,
    SF_COMET.RATE_DUST_HI,
    SF_COMET.DUST_TILT
  )

  const dustGas = tailLayer(
    THREE,
    rand,
    glowTex,
    SF_COLORS.COMET_DUST,
    r * SF_COMET.DUST_LEN,
    r * SF_COMET.SPREAD_DUST * SF_COMET.SHEATH_W,
    SF_COMET.GROW_DUST,
    SF_COMET.PTS_HALO,
    r * SF_COMET.PSZ_HALO * SF_COMET.DUST_PSIZE,
    SF_COMET.DUST_OPACITY * SF_COMET.OP_HALO,
    SF_COMET.RATE_DUST_LO * SF_COMET.HALO_SLOW,
    SF_COMET.RATE_DUST_HI * SF_COMET.HALO_SLOW,
    SF_COMET.DUST_TILT
  )

  return { mesh, coma, ion, dust, ionGas, dustGas }
}
