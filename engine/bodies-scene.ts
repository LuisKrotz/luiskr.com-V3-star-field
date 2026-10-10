/**
 * @file engine/bodies-scene.ts
 * @description Scene-graph builder for the star-field catalog — turns each
 * SFBodyDef into a pickable node: textured sphere for mapped bodies,
 * procedural MeshStandard for dwarf planets, unlit MeshBasic for stars,
 * billboard sprites for nebulae, tilted gradient discs for galaxies, plus
 * Saturn/Venus shell layers, the accretion ring on Sgr A*, orbit guide
 * rings, and decorative satellite pivots.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL, SF_SCENE, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { makeSpiralGalaxy } from './spiral.js'
import { makeGalaxyDisc, makeNebulaSprite } from './bodies/deep-sky.js'
import { makeBlackHole } from './bodies/black-hole.js'
import { makeStructure } from './bodies/structures.js'
import type { SFBodyDef, SFNode, SFState } from './types.js'

type ThreeModule = typeof import('three')

/** `userData` key carrying the body id from mesh → raycast hit. */
export const SF_USER_BODY = 'bodyId'

/**
 * `userData` flag marking an invisible oversized pick proxy — picking
 * prefers a real-mesh hit down the ray so proxy bubbles never eclipse
 * the bodies they overlap.
 */
export const SF_USER_PROXY = 'pickProxy'

/**
 * Invisible pick bubble for bodies too small to hit reliably — planets
 * and moons under `SF_DETAIL.PICK_MIN` world units subtend a handful of
 * pixels at the home camera, so a slightly larger transparent sphere
 * (riding inside `mesh` to inherit orbit position and spin) gives the
 * raycaster a usable target. Marked `SF_USER_PROXY` so a real-mesh hit
 * along the same ray always wins.
 * @param THREE The three.js module.
 * @param def Catalog entry (body id stamped on `userData`).
 * @returns The invisible proxy mesh.
 */
function makePickProxy(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Object3D {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(SF_DETAIL.PICK_MIN, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  )

  proxy.userData[SF_USER_PROXY] = true

  return proxy
}

/**
 * Sphere + material for a solid body — textured when the catalog maps one,
 * tinted procedural otherwise. Stars/systems use unlit MeshBasic (they
 * emit their own light); planets and smaller get lit MeshStandard.
 * @param THREE The three.js module.
 * @param def Catalog entry.
 * @param texMap Loaded texture map keyed by URL.
 */
function makeSphere(THREE: ThreeModule, def: SFBodyDef, texMap: Map<string, THREE_NS.Texture>) {
  const geo = new THREE.SphereGeometry(
    def.radius,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const luminous = def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM

  if (luminous) {
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: texMap.get(def.texture ?? ''), color: def.color })
    )
  }

  const mat = new THREE.MeshStandardMaterial({
    map: texMap.get(def.texture ?? ''),
    color: def.color,
  })

  // Relief + night-lights detail layers — Earth's three extra maps land
  // on the same material: `normalMap` shades terrain relief under the
  // sun light rig, `emissiveMap` carries city lights that stay black on
  // the day side.
  const nrmTex = def.normalTexture ? texMap.get(def.normalTexture) : undefined

  if (nrmTex) mat.normalMap = nrmTex

  const bumpTex = def.bumpTexture ? texMap.get(def.bumpTexture) : undefined

  if (bumpTex) {
    mat.bumpMap = bumpTex
    mat.bumpScale = SF_DETAIL.BUMP_SCALE
  }

  const emiTex = def.emissiveTexture ? texMap.get(def.emissiveTexture) : undefined

  if (emiTex) {
    mat.emissiveMap = emiTex
    mat.emissive = new THREE.Color(SF_COLORS.SUN_LIGHT)
    mat.emissiveIntensity = SF_DETAIL.EMISSIVE_INT
  }

  return new THREE.Mesh(geo, mat)
}

/**
 * Extra translucent sphere one shell above a surface — Earth's cloud
 * deck rides a white-on-black map under additive blending so the dark
 * sky between clouds contributes nothing; the deck scales slightly past
 * the surface sphere so it reads as atmosphere, not paint.
 * @param THREE The three.js module.
 * @param def Catalog entry (radius sizes the shell).
 * @param cloudTex The loaded cloud map (caller guards its presence).
 */
function makeCloudShell(
  THREE: ThreeModule,
  def: SFBodyDef,
  cloudTex: THREE_NS.Texture
): THREE_NS.Object3D {
  const geo = new THREE.SphereGeometry(
    def.radius * SF_DETAIL.CLOUD_SCALE,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: SF_DETAIL.CLOUD_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  return new THREE.Mesh(geo, mat)
}

/**
 * Additive halo sprite behind a luminous body — stars and the Sun glow
 * like point sources on a real long-exposure frame instead of rendering
 * as flat colored balls. Kept off the LOD `detail` list: a star's glow
 * IS its far-field representation.
 * @param THREE The three.js module.
 * @param def Catalog entry (color tints the halo).
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 */
function makeStarHalo(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): THREE_NS.Sprite {
  const size = def.radius * SF_DETAIL.HALO_SCALE

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: def.color ?? SF_COLORS.SUN_LIGHT,
      transparent: true,
      opacity: SF_DETAIL.HALO_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )

  sprite.scale.set(size, size, 1)

  return sprite
}

/**
 * Translucent shell layer — Venus's haze atmosphere and Saturn's ring get
 * a secondary texture-mapped surface parented to the main mesh. Returns
 * the created Object3D so the caller can register it as LOD detail.
 * @param THREE The three.js module.
 * @param def Catalog entry.
 * @param shellTexture Shell texture URL — narrowed non-null by the caller's
 *   `if (def.shellTexture)` guard.
 * @param parent The primary mesh the shell rides on.
 * @param texMap Loaded texture map keyed by URL.
 */
function makeShell(
  THREE: ThreeModule,
  def: SFBodyDef,
  shellTexture: string,
  parent: { add(o: unknown): unknown },
  texMap: Map<string, THREE_NS.Texture>
): THREE_NS.Object3D {
  const tex = texMap.get(shellTexture)

  if (def.shellRing) {
    const inner = def.radius * SF_DETAIL.RING_INNER

    const outer = def.radius * SF_DETAIL.RING_OUTER

    const geo = new THREE.RingGeometry(inner, outer, SF_SCENE.RING_SEGMENTS)

    /**
     * RingGeometry ships planar UVs (the ring occupies uv-space like a
     * circle inscribed in a square), but the Saturn strip texture is
     * radius-indexed — u sweeps inner→outer across the banded ring face.
     * Remap each vertex's u to its normalized radius (v rides the strip's
     * center row) so the C/B/A ring bands and the Cassini gap land at
     * their true radii instead of smearing into a solid plate.
     */
    const posAttr = geo.getAttribute('position')

    const uvAttr = geo.getAttribute('uv')

    // `Math.max(1, ·)` guards the degenerate-attribute case (mocked or
    // stripped geometries) — a real RingGeometry always has vertices.
    for (let i = 0; i < Math.max(1, posAttr.count); i++) {
      const r = Math.hypot(posAttr.getX(i), posAttr.getY(i))

      uvAttr.setXY(i, (r - inner) / (outer - inner), SF_DETAIL.RING_V)
    }

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const ring = new THREE.Mesh(geo, mat)

    ring.rotation.x = -Math.PI / 2 + (def.tilt ?? 0.3)

    parent.add(ring)

    return ring
  }

  const geo = new THREE.SphereGeometry(
    def.radius * 1.06,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.65 })

  const shell = new THREE.Mesh(geo, mat)

  parent.add(shell)

  return shell
}

/**
 * Decorative companion satellites — small unlit spheres on child pivots;
 * `satPivots` returns the {pivot,speed,phase} records frame.ts rotates.
 */
function makeSatellites(THREE: ThreeModule, def: SFBodyDef, mesh: { add(o: unknown): unknown }) {
  const satPivots: SFNode['satPivots'] = []

  for (const sat of def.satellites ?? []) {
    const pivot = new THREE.Object3D()

    const geo = new THREE.SphereGeometry(sat.radius, 24, 12)

    const mat = new THREE.MeshBasicMaterial({ color: sat.color })

    const sm = new THREE.Mesh(geo, mat)

    sm.position.x = sat.orbit

    pivot.add(sm)

    pivot.rotation.y = sat.phase ?? 0

    mesh.add(pivot)

    satPivots.push({ pivot, speed: sat.speed, phase: sat.phase ?? 0 })
  }

  return satPivots
}

/**
 * Orbit guide ring — a thin hairline torus in the orbital plane marking
 * the path; centered on the parent's anchor so moon rings ride Earth.
 */
function makeOrbitRing(THREE: ThreeModule, def: SFBodyDef, orbit: number) {
  const geo = new THREE.RingGeometry(orbit - 0.08, orbit + 0.08, SF_SCENE.ORBIT_SEGMENTS)

  const mat = new THREE.MeshBasicMaterial({
    color: SF_COLORS.ORBIT_LINE,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const ring = new THREE.Mesh(geo, mat)

  ring.rotation.x = -Math.PI / 2

  return ring
}

/**
 * Builds every catalog body into the scene graph: pivots for orbiting
 * bodies (rotation.y = phase + t·speed), fixed groups for `pos` bodies,
 * satellites, shells and guide rings, then registers the node, anchor
 * and pickable in the state maps.
 * @param s Engine state.
 * @param THREE The three.js module.
 * @param defs Catalog entries.
 * @param texMap Loaded texture map keyed by URL.
 * @param glowTex Shared glow texture for sprites/discs (may be undefined).
 */
export function buildStarBodies(
  s: SFState,
  THREE: ThreeModule,
  defs: readonly SFBodyDef[],
  texMap: Map<string, THREE_NS.Texture>,
  glowTex: THREE_NS.Texture | undefined
): void {
  for (const def of defs) {
    const pivot = new THREE.Object3D()

    let mesh: THREE_NS.Object3D
    let pickMesh: THREE_NS.Object3D | null = null
    let spinner: THREE_NS.Object3D | null = null

    if (def.kind === SF_KINDS.NEBULA || def.kind === SF_KINDS.CLUSTER) {
      mesh = makeNebulaSprite(THREE, def, texMap, glowTex)
    } else if (def.kind === SF_KINDS.STRUCTURE) {
      // Hierarchy shells — a boundary sphere + member speckles; never
      // registered in `pickables` (a multi-thousand-unit shell would
      // swallow every ray). The navigator still flies to its anchor.
      mesh = makeStructure(THREE, def, glowTex)
    } else if (def.kind === SF_KINDS.BLACK_HOLE) {
      // Sgr A* — layered relativistic composite; the plasma swirl is the
      // rotating layer so `spin` orbits the accretion flow without
      // tumbling the jets or disc.
      const bh = makeBlackHole(THREE, def, glowTex)

      mesh = bh.group
      spinner = bh.spin
    } else if (def.kind === SF_KINDS.GALAXY || def.kind === SF_KINDS.DWARF_GALAXY) {
      if (def.spiralDisc) {
        const spiral = makeSpiralGalaxy(
          THREE,
          def,
          texMap,
          glowTex,
          (s.canvas?.clientWidth ?? 0) < SF_SPIRAL.MOBILE_WIDTH
        )

        mesh = spiral.group

        pickMesh = spiral.pick
      } else {
        mesh = makeGalaxyDisc(THREE, def, texMap, glowTex)
      }
    } else {
      mesh = makeSphere(THREE, def, texMap)

      // Sub-pixel bodies get an invisible pick bubble inside the mesh so
      // they stay clickable at the home zoom; the bubble is a proxy — a
      // real-mesh hit along the same ray still wins in `pickAt`.
      if (def.radius < SF_DETAIL.PICK_MIN) {
        pickMesh = makePickProxy(THREE, def)

        mesh.add(pickMesh)
      }
    }

    mesh.userData[SF_USER_BODY] = def.id

    if (pickMesh) {
      pickMesh.userData[SF_USER_BODY] = def.id
      pickMesh.userData[SF_USER_PROXY] = true
    }

    if (def.orbit != null) {
      mesh.position.x = def.orbit

      pivot.rotation.y = def.phase ?? 0
    } else if (def.pos) {
      pivot.position.set(def.pos[0], def.pos[1], def.pos[2])
    }

    pivot.add(mesh)

    // Axial tilt applies to sphere-path bodies only — galaxy groups own
    // their rotation.x disc tilt, structures are spherical boundaries,
    // and the black-hole composite aligns its own disc/jet axis.
    if (
      def.tilt &&
      def.kind !== SF_KINDS.GALAXY &&
      def.kind !== SF_KINDS.DWARF_GALAXY &&
      def.kind !== SF_KINDS.STRUCTURE &&
      def.kind !== SF_KINDS.BLACK_HOLE
    ) {
      mesh.rotation.z = def.tilt
    }

    const detail: THREE_NS.Object3D[] = []

    if (def.shellTexture) detail.push(makeShell(THREE, def, def.shellTexture, mesh, texMap))

    const cloudTex = def.cloudTexture ? texMap.get(def.cloudTexture) : undefined

    if (cloudTex) {
      const clouds = makeCloudShell(THREE, def, cloudTex)

      mesh.add(clouds)

      detail.push(clouds)
    }

    // Luminous bodies glow past their limb — the halo rides on the pivot
    // (not `detail`) so a distant star still reads as a light source.
    if (def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM) {
      mesh.add(makeStarHalo(THREE, def, glowTex))
    }

    const satPivots = makeSatellites(THREE, def, mesh)

    detail.push(...satPivots.map((sat) => sat.pivot))

    const anchor = def.parent ? s.anchors.get(def.parent) : s.scene

    if (anchor) anchor.add(pivot)

    if (def.ring && def.orbit != null) {
      const ring = makeOrbitRing(THREE, def, def.orbit)

      anchor?.add(ring)

      s.rings.push(ring)

      detail.push(ring)
    }

    const node: SFNode = { def, pivot, mesh, spinner: spinner ?? mesh, satPivots, detail }

    s.nodes.set(def.id, node)
    s.anchors.set(def.id, mesh)

    // Hierarchy shells never enter the raycast set — their enormous
    // boundary spheres would intercept every pointer ray in the scene.
    if (def.kind !== SF_KINDS.STRUCTURE) {
      s.pickables.push(pickMesh ?? mesh)
    }
  }
}
