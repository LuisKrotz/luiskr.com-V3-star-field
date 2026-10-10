/**
 * @file engine/bodies/black-hole.ts
 * @description Sagittarius A* renderer — a layered relativistic object
 * instead of the old bare black ball + flat ring:
 *
 *   event horizon   — pure-black sphere at `def.radius`
 *   photon ring     — thin additive torus at ~1.35 R, the light-trapping
 *                     orbit that makes the EHT silhouette read
 *   accretion disc  — hot additive annulus 1.6–4.2 R in the local disc
 *                     plane (the galactic plane for a MW-anchored body)
 *   plasma swirl    — 1,400 seeded particles inside the annulus; this
 *                     object becomes the node's `spinner` so `def.spin`
 *                     orbits the plasma like real keplerian shear
 *   polar jets      — twin additive cones along the local Y axis (the
 *                     disc normal → the MW poles) when `def.jets` is set
 *   glow sprite     — soft warm halo at 11 R for lensing bloom
 *
 * All sizes are multiples of `def.radius` (SF_BH tokens), so the catalog
 * radius stays the single source of truth and the dossier's "4.3 M☉"
 * mass scales the whole assembly together.
 */
import type * as THREE_NS from 'three'
import { SF_BH, SF_COLORS } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../rand.js'
import { matParams } from '../materials.js'
import type { SFBodyDef, SFNodeDeps } from '../types.js'

type ThreeModule = typeof import('three')

/**
 * Dusty accretion annulus — a node-material ring whose heat falls off
 * radially and whose dust lanes break the surface into turbulent bands.
 * Per fragment, `k` walks the annulus inner→outer and the brightness
 * falls off ~quadratically (the ISCO edge is blinding, the rim fades to
 * dust); two detuned ring-harmonics multiply into irregular dark lanes —
 * the dust absorption bands real discs show — so the annulus reads as
 * turbulent plasma with structure, never a smooth polygon. Output is
 * premultiplied for additive blending (dark lanes add nothing). Built
 * as a TSL node graph — the WebGPURenderer pipeline rejects classic
 * GLSL ShaderMaterials. RingGeometry is authored flat in XY (the mesh
 * rotates −π/2 into the XZ disc plane), so `positionLocal.xy` is the
 * annulus plane coordinate.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param def Catalog entry (radius scales the annulus).
 */
function makeAccretionDisc(THREE: ThreeModule, deps: SFNodeDeps, def: SFBodyDef): THREE_NS.Mesh {
  const inner = def.radius * SF_BH.DISC_INNER
  const outer = def.radius * SF_BH.DISC_OUTER

  const { TSL, mats } = deps

  const { positionLocal, float, clamp, atan, sin, pow, mix, uniform } = TSL

  // Annulus coordinate — ring is flat in local XY pre-rotation.
  const p = positionLocal.xy

  const r = p.length()

  // GLSL two-arg atan(y, x) — TSL names it `atan`, not `atan2`.
  const ang = atan(p.y, p.x)

  // k: 0 at the ISCO edge → 1 at the dusty rim.
  const k = clamp(r.sub(inner).div(outer - inner), 0, 1)

  // Dust lanes — two detuned ring waves multiply into irregular dark
  // banding (the floor keeps lanes translucent, never solid cuts).
  const lanes = float(SF_BH.DISC_LANE_FLOOR).add(
    sin(ang.mul(SF_BH.DISC_LANE_ANG_A).add(r.mul(SF_BH.DISC_LANE_RAD_A)))
      .mul(sin(r.mul(SF_BH.DISC_LANE_RAD_B).sub(ang.mul(SF_BH.DISC_LANE_ANG_B))))
      .mul(SF_BH.DISC_LANE_AMP)
  )

  // Radial heat envelope — quadratic-ish falloff away from the ISCO.
  const core = pow(k.oneMinus(), SF_BH.DISC_CORE_EXP)

  const hot = uniform(new THREE.Color(SF_COLORS.BH_PHOTON))

  const warm = uniform(new THREE.Color(SF_COLORS.ACCRETION))

  const col = mix(hot, warm, k).mul(lanes)

  const a = core
    .mul(float(SF_BH.DISC_A_FLOOR).add(lanes.mul(SF_BH.DISC_A_AMP)))
    .mul(SF_BH.DISC_OPACITY)

  const mat = new mats.MeshBasicNodeMaterial()

  mat.colorNode = col.mul(a)
  mat.opacityNode = a
  mat.transparent = true
  mat.side = THREE.DoubleSide
  mat.blending = THREE.AdditiveBlending
  mat.depthWrite = false

  const disc = new THREE.Mesh(new THREE.RingGeometry(inner, outer, SF_BH.DISC_SEGMENTS), mat)

  disc.rotation.x = -Math.PI / 2

  return disc
}

/**
 * Orbiting accretion plasma — seeded particles inside the annulus
 * (DISC_INNER–DISC_OUTER × radius) on a thin vertical gaussian; colors
 * ramp from near-white at the ISCO edge to dim amber at the rim, which
 * is where the "glowing ring against black" contrast comes from. The
 * returned Points object is the node's spinner: frame.ts rotates its
 * `rotation.y` every tick so the plasma visibly orbits while the disc
 * ring, jets and horizon stay frame-aligned.
 * @param THREE The three.js module.
 * @param def Catalog entry (radius sets the annulus scale).
 * @param glowTex Shared soft-disc texture (may be undefined).
 */
function makeSwirl(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): THREE_NS.Points {
  const count = SF_BH.SWIRL_COUNT

  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  const rand = lcg(seedFrom(def.id))

  const inner = def.radius * SF_BH.DISC_INNER

  const outer = def.radius * SF_BH.DISC_OUTER

  for (let i = 0; i < count; i++) {
    // sqrt-uniform area weighting — equal plasma density per disc area.
    const r = inner + Math.sqrt(rand()) * (outer - inner)

    const angle = rand() * Math.PI * 2

    // Thin vertical scatter — inner plasma orbits hotter/thicker.
    const puff = 1 - (r - inner) / (outer - inner)

    pos[i * 3] = Math.cos(angle) * r
    pos[i * 3 + 1] =
      (rand() + rand() - 1) * def.radius * SF_BH.SWIRL_PUFF * (SF_BH.SWIRL_BIAS + puff)
    pos[i * 3 + 2] = Math.sin(angle) * r

    // ISCO-hot → rim-dim ramp (whitish core into the ACCRETION amber).
    const k = (r - inner) / (outer - inner)

    col[i * 3] = SF_BH.SWIRL_CORE_R + (SF_BH.SWIRL_EDGE_R - SF_BH.SWIRL_CORE_R) * k
    col[i * 3 + 1] = SF_BH.SWIRL_CORE_G + (SF_BH.SWIRL_EDGE_G - SF_BH.SWIRL_CORE_G) * k
    col[i * 3 + 2] = SF_BH.SWIRL_CORE_B + (SF_BH.SWIRL_EDGE_B - SF_BH.SWIRL_CORE_B) * k
  }

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  // Empty uv — the node pipeline samples `uv` for `map` even though
  // points shade via gl_PointCoord; declaring it keeps the graph quiet.
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))

  const mat = new THREE.PointsMaterial(
    matParams({
      size: SF_BH.SWIRL_PX,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  )

  const points = new THREE.Points(geo, mat)

  points.raycast = () => undefined

  return points
}

/**
 * One relativistic jet — a long additive cone along ±Y (the local disc
 * normal, i.e. the galactic pole for the MW-anchored Sgr A*). Slight
 * radial widening with distance (radius*JET_WIDTH base → near-zero tip
 * keeps the beam collimated) and low opacity so overlapping additive
 * layers never bloom white.
 * @param THREE The three.js module.
 * @param def Catalog entry.
 * @param dir +1 north polar jet, −1 south.
 */
function makeJet(THREE: ThreeModule, def: SFBodyDef, dir: number): THREE_NS.Mesh {
  const len = def.radius * SF_BH.JET_LEN

  const geo = new THREE.CylinderGeometry(
    def.radius * SF_BH.JET_TIP,
    def.radius * SF_BH.JET_WIDTH,
    len,
    24,
    1,
    true
  )

  // Per-vertex brightness fade — additive blending turns black into
  // transparent, so the beam dissolves along its length instead of
  // reading as a hard straight rod. Bright at the horizon, gone at tip.
  const posAttr = geo.getAttribute('position')
  const fades = new Float32Array(posAttr.count * 3)

  for (let i = 0; i < posAttr.count; i++) {
    // Cylinder local y runs −len/2 (wide base at the hole) → +len/2 (tip).
    const k = (posAttr.getY(i) + len / 2) / len
    const fade = (1 - k) * (1 - k)

    fades[i * 3] = fade
    fades[i * 3 + 1] = fade
    fades[i * 3 + 2] = fade
  }

  geo.setAttribute('color', new THREE.BufferAttribute(fades, 3))

  const mat = new THREE.MeshBasicMaterial({
    color: SF_COLORS.BH_JET,
    vertexColors: true,
    transparent: true,
    opacity: SF_BH.JET_OPACITY,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const jet = new THREE.Mesh(geo, mat)

  // Cone tip points away from the hole; position rides half the length
  // out so the base starts at the horizon. For the south jet the mesh is
  // also flipped — otherwise the cylinder's narrow tip would end up
  // against the horizon and the beam would open outward upside-down.
  jet.position.y = dir * (len / 2 + def.radius)

  if (dir < 0) jet.rotation.z = Math.PI

  jet.raycast = () => undefined

  return jet
}

/**
 * Assembles the full Sagittarius A* composite: black horizon sphere,
 * additive photon torus, hot accretion annulus, seeded plasma swirl
 * (returned as `spin` — the node's rotating layer), optional bipolar
 * jets, and a warm lensing glow. Everything lives in the local XZ
 * plane / ±Y normal, which inside the Milky Way's tilted group is the
 * galactic plane and poles.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param def Catalog entry (`kind: blackHole`; `jets` adds the cones).
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 * @returns `{ group, spin }` — scene node + per-frame rotation target.
 */
export function makeBlackHole(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): { group: THREE_NS.Object3D; spin: THREE_NS.Object3D } {
  const group = new THREE.Group()

  // Event horizon — pure black sphere; the photon ring + swirl around it
  // produce the silhouette.
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius, 48, 24),
    new THREE.MeshBasicMaterial({ color: SF_COLORS.SAGITTARIUS_A })
  )

  group.add(horizon)

  // Photon ring — the thin relativistic light circle the EHT resolves;
  // TorusGeometry lies in the XY plane so rotate flat into XZ.
  const photon = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius * SF_BH.PHOTON_RING, def.radius * SF_BH.PHOTON_TUBE, 16, 96),
    new THREE.MeshBasicMaterial({
      color: SF_COLORS.BH_PHOTON,
      transparent: true,
      opacity: SF_BH.PHOTON_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )

  photon.rotation.x = Math.PI / 2

  group.add(photon)

  // Dusty accretion annulus — node-material ring with heat falloff +
  // dust lanes under the particle swirl (see makeAccretionDisc).
  group.add(makeAccretionDisc(THREE, deps, def))

  const swirl = makeSwirl(THREE, def, glowTex)

  group.add(swirl)

  // Bipolar synchrotron jets along the local pole when the catalog
  // flags them (Sgr A* — Fermi-bubble stand-in).
  if (def.jets) {
    group.add(makeJet(THREE, def, 1))
    group.add(makeJet(THREE, def, -1))
  }

  // Lensing bloom — soft warm sprite so the object glows like the
  // energetic core it is even at chart zoom.
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial(
      matParams({
        map: glowTex,
        color: SF_COLORS.ACCRETION,
        transparent: true,
        opacity: SF_BH.GLOW_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  )

  const gs = def.radius * SF_BH.GLOW_SCALE

  glow.scale.set(gs, gs, 1)

  group.add(glow)

  return { group, spin: swirl }
}
