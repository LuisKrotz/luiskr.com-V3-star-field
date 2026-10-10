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

  for (let i = 0; i < count; i++) {
    // Uniform-volume scatter — cbrt(uniform) fills a sphere evenly.
    const r = Math.cbrt(rand()) * fillR

    const u = rand() * 2 - 1

    const theta = rand() * Math.PI * 2

    const s = Math.sqrt(1 - u * u)

    pos[i * 3] = Math.cos(theta) * s * r
    pos[i * 3 + 1] = u * r
    pos[i * 3 + 2] = Math.sin(theta) * s * r

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

  mat.colorNode = tint.mul(rim).mul(SF_STRUCTURE.SHELL_OPACITY)
  mat.transparent = true
  mat.side = THREE.FrontSide
  mat.blending = THREE.AdditiveBlending
  mat.depthWrite = false

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

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius, SF_STRUCTURE.SEGMENTS, SF_STRUCTURE.SEGMENTS / 2),
    makeShellMaterial(THREE, deps, def)
  )

  shell.raycast = () => undefined

  group.add(shell)

  const speckles = def.structure?.speckles ?? 0

  if (speckles > 0) {
    group.add(makeSpeckles(THREE, def, radius, Math.min(speckles, SF_STRUCTURE.SPECKLE_COUNT)))
  }

  return group
}
