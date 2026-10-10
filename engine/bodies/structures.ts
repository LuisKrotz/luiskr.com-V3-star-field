/**
 * @file engine/bodies/structures.ts
 * @description Cosmic-hierarchy bodies — boundary spheres + member
 * speckle clouds for the chart's largest structures (Local Group
 * volume, superclusters, the observable-universe rim). Each is a faint
 * translucent shell whose `radius` comes from the def's `structure`
 * field, plus an interior Points cloud standing in for the member
 * galaxy population.
 *
 * Structures are deliberately NOT raycast pickable — a 20k-unit shell
 * would swallow every pointer ray and eclipse the real bodies inside;
 * they are navigator/fly-to targets only. Raycasts are disabled on
 * every child so `s.pickables` never even sees them.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_STRUCTURE } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../rand.js'
import type { SFBodyDef, SFNodeDeps } from '../types.js'

type ThreeModule = typeof import('three')

/**
 * Member-galaxy speckle cloud — seeded uniform-sphere scatter inside
 * `SPECKLE_FILL` of the shell radius so members keep off the boundary
 * skin. Brightness jitters per point so the cloud reads as a galaxy
 * field rather than noise static; additive tiny points, never pickable.
 * @param THREE The three.js module.
 * @param def Catalog entry (id seeds the scatter).
 * @param radius Speckle volume radius in chart units.
 * @param count Speckle count.
 */
function makeSpeckles(
  THREE: ThreeModule,
  def: SFBodyDef,
  radius: number,
  count: number
): THREE_NS.Points {
  const pos = new Float32Array(count * 3)

  const col = new Float32Array(count * 3)

  const rand = lcg(seedFrom(def.id))

  const tint = new THREE.Color(def.color ?? SF_COLORS.SPECKLE)

  const fillR = radius * SF_STRUCTURE.SPECKLE_FILL

  // Galaxy clusters/superclusters are not spheres — they are knotted
  // filaments/sheets. Build a seeded principal axis and 2–3 density
  // knots along it; each member is scattered gaussian around a knot so
  // the cloud reads as a beaded thread, not a disco ball.
  const au = rand() * 2 - 1
  const ath = rand() * Math.PI * 2
  const as = Math.sqrt(1 - au * au)
  const axis = [Math.cos(ath) * as, au, Math.sin(ath) * as]

  // Perpendicular basis for the lateral scatter.
  const p1 = [axis[1], -axis[0], 0]
  const p1len = Math.max(Math.hypot(p1[0], p1[1]), 1e-9)
  const lat1 = [p1[0] / p1len, p1[1] / p1len, 0]
  const lat2 = [
    axis[1] * lat1[2] - axis[2] * lat1[1],
    axis[2] * lat1[0] - axis[0] * lat1[2],
    axis[0] * lat1[1] - axis[1] * lat1[0],
  ]

  const knots = 2 + Math.floor(rand() * 2)
  const knotAt: number[] = []

  for (let k = 0; k < knots; k++) {
    // Knots spread along the axis — jittered so no two structures match.
    knotAt.push((k / Math.max(knots - 1, 1) - 0.5) * fillR * (0.9 + rand() * 0.5))
  }

  const g = () => (rand() + rand() + rand() - 1.5) * fillR * 0.14

  for (let i = 0; i < count; i++) {
    const ki = Math.floor(rand() * knots)
    const along = knotAt[ki] + g() * 1.6
    const l1 = g()
    const l2 = g() * SF_STRUCTURE.SPECKLE_FLATTEN

    pos[i * 3] = axis[0] * along + lat1[0] * l1 + lat2[0] * l2
    pos[i * 3 + 1] = axis[1] * along + lat1[1] * l1 + lat2[1] * l2
    pos[i * 3 + 2] = axis[2] * along + lat1[2] * l1 + lat2[2] * l2

    const bright = SF_STRUCTURE.SPECKLE_DIM + rand() * (1 - SF_STRUCTURE.SPECKLE_DIM)

    col[i * 3] = tint.r * bright
    col[i * 3 + 1] = tint.g * bright
    col[i * 3 + 2] = tint.b * bright
  }

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const mat = new THREE.PointsMaterial({
    size: SF_STRUCTURE.SPECKLE_PX,
    vertexColors: true,
    transparent: true,
    opacity: SF_STRUCTURE.SPECKLE_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geo, mat)

  points.raycast = () => undefined

  return points
}

/**
 * Fresnel-rim boundary shell — a node material whose emission peaks
 * where the surface grazes the view ray (the bubble silhouette) and
 * falls to zero face-on, so the shell never paints a flat filled disc
 * over the sky. The node graph is the TSL translation of the original
 * GLSL rim shader — the WebGPURenderer pipeline rejects classic
 * ShaderMaterials. Output is premultiplied (`color·opacity·rim`) so
 * additive blending adds exactly the rim glow.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param def Catalog entry — `def.color` tints the bubble.
 */
function makeShellMaterial(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef
): THREE_NS.Material {
  const { TSL, mats } = deps

  const { normalize, cameraPosition, positionWorld, normalWorld, pow, dot, uniform } = TSL

  // rim = (1 − |view·n|)^power — 0 face-on, 1 at the silhouette.
  const viewDir = normalize(cameraPosition.sub(positionWorld))

  const rim = pow(dot(viewDir, normalWorld).abs().oneMinus(), SF_STRUCTURE.SHELL_RIM)

  const mat = new mats.MeshBasicNodeMaterial()

  const tint = uniform(new THREE.Color(def.color ?? SF_COLORS.SHELL_LOCAL))

  const fade = uniform(1)

  mat.colorNode = tint.mul(rim).mul(SF_STRUCTURE.SHELL_OPACITY).mul(fade)
  mat.transparent = true
  mat.side = THREE.FrontSide
  mat.blending = THREE.AdditiveBlending
  mat.depthWrite = false

  // Expose the fade uniform so frame.ts can hide the shell when the
  // camera is deep inside it — otherwise the far wall paints a bright
  // bubble silhouette over the whole view.
  mat.userData = { fade }

  return mat
}

/**
 * Builds one hierarchy structure: a low-poly fresnel-rim boundary
 * sphere plus the optional interior speckle volume. The rim material
 * makes the shell read as a soap bubble — only the silhouette glows,
 * face-on area adds nothing — so nested shells can never stack into
 * a flat film over the sky (the BackSide wash bug), and the boundary
 * blends into the black instead of cutting a hard disc. Every child's
 * raycast is stubbed so the shell can never eat a pointer hit meant
 * for bodies inside it.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param def Catalog entry — `structure.radius` sets the shell size.
 * @param glowTex Unused (kept for maker-signature symmetry).
 * @returns The structure group.
 */
export function makeStructure(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  glowTex?: THREE_NS.Texture
): THREE_NS.Object3D {
  void glowTex

  const group = new THREE.Group()

  const radius = def.structure?.radius ?? def.radius

  const shellMat = makeShellMaterial(THREE, deps, def)

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius, SF_STRUCTURE.SEGMENTS, SF_STRUCTURE.SEGMENTS / 2),
    shellMat
  )

  shell.raycast = () => undefined

  group.add(shell)

  let speckleMat: THREE_NS.PointsMaterial | null = null
  const speckles = def.structure?.speckles ?? 0

  if (speckles > 0) {
    const points = makeSpeckles(THREE, def, radius, Math.min(speckles, SF_STRUCTURE.SPECKLE_COUNT))

    speckleMat = points.material as THREE_NS.PointsMaterial

    group.add(points)
  }

  // frame.ts reads radius and the shell fade uniform to hide the inside
  // of each hierarchy bubble when the camera sits within it.
  group.userData = {
    isStructure: true,
    radius,
    fade: shellMat.userData?.fade,
    speckleMat,
  }

  return group
}
