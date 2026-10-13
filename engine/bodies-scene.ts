/**
 * @file engine/bodies-scene.ts
 * @description Scene-graph assembler for the star-field catalog — turns
 * each SFBodyDef into a pickable node by dispatching on kind: textured
 * spheres for mapped bodies, billboard sprites for nebulae, galaxy
 * discs, the black-hole composite, hierarchy structures, small-body
 * belts, plus shells, halos, coronae and satellite pivots from
 * `bodies/primitives.ts`, and finally the galactic co-rotation rider
 * that carries everything heliocentric around the Milky Way.
 */
import type * as THREE_NS from 'three'
import {
  SF_BODY_IDS,
  SF_COLORS,
  SF_CONSTELLATION,
  SF_DETAIL,
  SF_SCALE,
  SF_SPIRAL,
} from '@core/tokens/starfield/params.js'
import { SF_GROUPS, SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { makeSpiralGalaxy } from './spiral.js'
import { makeGalaxyDisc, makeNebulaSprite } from './bodies/deep-sky.js'
import { makeBlackHole } from './bodies/black-hole.js'
import { makeStructure } from './bodies/structures.js'
import { makeBelt } from './bodies/belt.js'
import { makeBeltRocks } from './bodies/belt-rocks.js'
import { coronaFor } from './bodies/procedural.js'
import {
  makeAurora,
  makeConstellation,
  makeMeteorPool,
  makeSolarFlares,
  makeWeatherClouds,
} from './bodies/weather.js'
import {
  makeAtmoShell,
  makeCloudShell,
  makePickProxy,
  makeSatellites,
  makeShell,
  makeSphere,
  makeStarHalo,
  SF_USER_BODY,
  SF_USER_PROXY,
} from './bodies/primitives.js'
import { matParams } from './materials.js'
import { lcg, seedFrom } from './rand.js'
import type { SFBodyDef, SFNode, SFNodeDeps, SFState } from './types.js'

export { SF_USER_BODY, SF_USER_PROXY } from './bodies/primitives.js'

type ThreeModule = typeof import('three')

/**
 * Builds every catalog body into the scene graph: pivots for orbiting
 * bodies (rotation.y = phase + t·speed), fixed groups for `pos` bodies,
 * satellites and shells, then registers the node, anchor
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
  deps: SFNodeDeps,
  defs: readonly SFBodyDef[],
  texMap: Map<string, THREE_NS.Texture>,
  glowTex: THREE_NS.Texture | undefined
): void {
  for (const def of defs) {
    const pivot = new THREE.Object3D()

    let mesh: THREE_NS.Object3D
    let pickMesh: THREE_NS.Object3D | null = null
    let spinner: THREE_NS.Object3D | null = null
    let rotor: THREE_NS.Object3D | undefined
    let lock: THREE_NS.Object3D | undefined
    let beltRockGroup: THREE_NS.Object3D | undefined
    let pointStar = false
    let farGlyph: THREE_NS.Object3D | undefined
    const rockPivots: SFNode['satPivots'] = []

    if (def.kind === SF_KINDS.NEBULA || def.kind === SF_KINDS.CLUSTER) {
      // Nebulae get an irregular wispy mask so they look like gas clouds;
      // clusters keep the clean radial feather.
      const lobes = def.kind === SF_KINDS.NEBULA ? 3 : 0

      mesh = makeNebulaSprite(THREE, def, texMap, glowTex, lobes)
    } else if (def.kind === SF_KINDS.STRUCTURE) {
      // Hierarchy shells — a boundary sphere + member speckles; never
      // registered in `pickables` (a multi-thousand-unit shell would
      // swallow every ray). The navigator still flies to its anchor.
      mesh = makeStructure(THREE, deps, def, glowTex)
    } else if (def.kind === SF_KINDS.BLACK_HOLE) {
      // Sgr A* — layered relativistic composite; the plasma swirl is the
      // rotating layer so `spin` orbits the accretion flow without
      // tumbling the jets or disc.
      const bh = makeBlackHole(THREE, deps, def, glowTex)

      mesh = bh.group
      spinner = bh.spin
    } else if (def.kind === SF_KINDS.BELT) {
      // Small-body annulus — a seeded Points disc; like structures it
      // stays out of the raycast set so its pebbles can't intercept
      // every pointer ray, but the navigator flies to its anchor.
      mesh = makeBelt(THREE, def, glowTex)

      // Hero rocks — irregular seeded meshes (stone/carbon/dust/ice/
      // metal, fragments through large bodies) on individual Keplerian
      // pivots, so a fly-in resolves real varied debris above the
      // particle rubble rather than a dotted hairline.
      const rocks = makeBeltRocks(THREE, def)

      beltRockGroup = rocks.group

      mesh.add(rocks.group)

      rockPivots.push(...rocks.pivots)
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

        // Whole-disc rigid spin — the solar system rides the disc via
        // the galactic rider (mountGalacticRider), so the carved
        // heliocentric bubble co-rotates with the Sun and stays locked.
        // The inner-disc rotor is kept separately for differential
        // rotation: tickFrame spins it faster than the disc rate so the
        // core laps the rim like a real flat rotation curve.
        spinner = spiral.group

        rotor = spiral.rotor
      } else {
        mesh = makeGalaxyDisc(THREE, def, texMap, glowTex)
      }
    } else {
      // Galactic stars are unresolvable points at honest chart distances
      // — the far-field representation is an invisible pick bubble + a
      // flat point-glow halo, while a full photosphere group (sphere +
      // annulus halo + corona + flares, built below) rides `detail` and
      // resolves only on approach. The authored `def.radius` keeps
      // driving the luminosity halo, the pick proxy and the fly-to
      // standoff — and, up close, the real star's surface.
      pointStar =
        (def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM) &&
        def.group !== SF_GROUPS.SOLAR &&
        def.radius > SF_DETAIL.POINT_RADIUS

      if (pointStar) {
        mesh = new THREE.Object3D()
        pickMesh = makePickProxy(THREE, def.radius)

        mesh.add(pickMesh)
      } else {
        // Day/night registry — a shared sun-direction vector per body
        // whose shading depends on illumination (night-lights emissive
        // gating, atmosphere rim tint); updateDayNight rewrites it each
        // frame so the TSL uniforms stay live.
        const sunDir =
          def.emissiveTexture || def.atmosphere ? new THREE.Vector3(1, 0, 0) : undefined

        mesh = makeSphere(THREE, deps, def, texMap, sunDir)

        if (sunDir) s.dayNight?.push({ anchor: mesh, dir: sunDir })

        // Sub-pixel bodies get an invisible pick bubble inside the mesh so
        // they stay clickable at the home zoom; the bubble is a proxy — a
        // real-mesh hit along the same ray still wins in `pickAt`.
        if (def.radius < SF_DETAIL.PICK_MIN) {
          pickMesh = makePickProxy(THREE, def.radius)

          mesh.add(pickMesh)
        }
      }
    }

    mesh.userData[SF_USER_BODY] = def.id

    if (pickMesh) {
      pickMesh.userData[SF_USER_BODY] = def.id
      pickMesh.userData[SF_USER_PROXY] = true
    }

    // Interstellar collapse glyph — past SF_LOD.SOLAR_FAR the whole
    // solar tier hides and the Sun must read as one bright star, like
    // every other system glyph in the neighborhood. The flat halo and
    // a dedicated pick proxy ride the pivot (NOT the mesh) so they stay
    // visible and tappable while updateLod hides the real photosphere.
    let farGlow: THREE_NS.Object3D | undefined
    let farPick: THREE_NS.Object3D | undefined

    if (
      def.group === SF_GROUPS.SOLAR &&
      (def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM)
    ) {
      farGlow = makeStarHalo(THREE, def, glowTex, true)

      farGlow.visible = false

      pivot.add(farGlow)

      farPick = makePickProxy(THREE, def.radius)

      farPick.userData[SF_USER_BODY] = def.id
      farPick.userData[SF_USER_PROXY] = true

      farPick.visible = false

      pivot.add(farPick)

      s.pickables.push(farPick)
    }

    // Body-system center — the non-rotating carrier at the orbit point.
    // The radial offset must live HERE, never on the mesh inside the
    // counter-rotating lock: pivot(θ)·lock(−θ) collapses to identity
    // and would pin every locked body on the parent's +X ray (moons
    // rendered as one rigid spoke, never orbiting). Satellites and
    // swarms also attach under `center` so they orbit the body's
    // position without inheriting surface spin or lock precession.
    const center = new THREE.Group()

    pivot.add(center)

    if (def.orbit != null) {
      center.position.x = def.orbit

      pivot.rotation.y = def.phase ?? 0

      // Orbital inclination — rotation.y is rewritten every frame by the
      // sweep, but rotation.x persists: the +x orbit arm sweeps out a
      // plane tipped `inc` radians about the parent's x-axis, so sibling
      // planets share a near-coplanar system without ever lining up.
      if (def.inc) pivot.rotation.x = def.inc
    } else if (def.pos) {
      pivot.position.set(def.pos[0], def.pos[1], def.pos[2])
    }

    // Axial tilt applies to sphere-path bodies only — galaxy groups own
    // their rotation.x disc tilt, structures are spherical boundaries,
    // and the black-hole composite aligns its own disc/jet axis.
    const sphereTilt =
      def.tilt &&
      def.kind !== SF_KINDS.GALAXY &&
      def.kind !== SF_KINDS.DWARF_GALAXY &&
      def.kind !== SF_KINDS.STRUCTURE &&
      def.kind !== SF_KINDS.BLACK_HOLE

    // Inertial axis lock — a directly orbiting body whose tilt rides the
    // mesh precesses with the orbit (axis always tilts along the radial
    // line → perpetual solstice, no seasons). The lock group carries the
    // tilt on rotation.z and counter-rotates on Y in tickFrame, keeping
    // the axis fixed in the parent frame so the terminator sweeps the
    // hemispheres over the year — real seasons. It wraps ONLY the mesh:
    // the orbit radius stays on `center` outside it, so the −θ counter-
    // rotation fixes orientation without collapsing the position.
    const useAxisLock = !!(sphereTilt && def.orbit != null && !def.parent)

    // Tidal lock needs no group at all — a moon mesh rigidly co-rotating
    // with its orbit pivot always shows the same hemisphere to the
    // parent (its day equals its year by construction). Any authored
    // tilt stays on the mesh inside the co-rotating frame.
    if (useAxisLock) {
      lock = new THREE.Group()

      lock.rotation.z = def.tilt as number

      center.add(lock)

      lock.add(mesh)
    } else {
      center.add(mesh)

      if (sphereTilt) mesh.rotation.z = def.tilt as number
    }

    const detail: THREE_NS.Object3D[] = []

    if (def.shellTexture) detail.push(makeShell(THREE, def, def.shellTexture, mesh, texMap))

    const cloudTex = def.cloudTexture ? texMap.get(def.cloudTexture) : undefined

    // Atmosphere rim — day/dusk/night tint migration driven by the same
    // shared sun-direction vector the night-lights gate uses.
    const dn = s.dayNight?.find((e) => e.anchor === mesh)

    if (cloudTex) {
      // Living weather (Earth): the procedural field — jets, storms,
      // ITCZ, snow lines, ash — replaces the static additive deck and
      // writes the matching cloud shadows onto the surface material.
      // Bodies without the flag keep the classic translucent shell.
      const clouds =
        def.weather && dn && s.fxTime
          ? makeWeatherClouds(
              THREE,
              deps,
              def,
              cloudTex,
              dn.dir,
              (mesh as { material?: unknown }).material,
              s.fxTime
            )
          : makeCloudShell(THREE, def, cloudTex)

      if (clouds) {
        mesh.add(clouds)

        detail.push(clouds)
      }
    }

    // Aurora curtains — polar emission fed by the shared solar-wind
    // uniform; a storm on the Sun lights every aurora-bearing world at
    // once (Earth plus the giant planets' high-latitude glow).
    if (def.aurora && s.fxTime) {
      const au = makeAurora(THREE, deps, def, s.fxTime, s.solarWind, dn?.dir)

      if (au) {
        mesh.add(au)

        detail.push(au)
      }
    }

    if (def.atmosphere && dn) {
      const atmo = makeAtmoShell(THREE, deps, def, dn.dir)

      mesh.add(atmo)

      detail.push(atmo)
    }

    // Luminous bodies glow past their limb — the halo rides on the pivot
    // (not `detail`) so a distant star still reads as a light source.
    let corona: SFNode['corona']

    // The surface stack — corona, flares and the limb-reading annulus
    // halo — mounts on `starHost`: `mesh` itself for resolved stars
    // (the solar tier), the approach-gated near-field group for
    // galactic point stars.
    let starHost = mesh

    if (def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM) {
      if (pointStar) {
        // Far glyph — the flat point glow a distant star reads as. It
        // stays live on `mesh` (always visible) and updateLod swaps it
        // off the moment the near-field group resolves, mirroring the
        // solar tier's farGlow hand-off in the opposite direction.
        farGlyph = makeStarHalo(THREE, def, glowTex, true)

        mesh.add(farGlyph)

        // Near-field star — the same photosphere the Sun wears (seeded
        // granulation, sunspots past the activity threshold, fresnel
        // limb darkening from `def.rim`), LOD-parked on `detail` so the
        // star resolves out of its own point glyph on approach instead
        // of staying a bright dot at every zoom.
        const nearStar = new THREE.Group()

        nearStar.visible = false
        nearStar.add(makeSphere(THREE, deps, def, texMap))
        nearStar.add(makeStarHalo(THREE, def, glowTex))

        mesh.add(nearStar)
        detail.push(nearStar)
        starHost = nearStar
      } else {
        mesh.add(makeStarHalo(THREE, def, glowTex))
      }

      // Corona sprite — seeded streamers + flare knots that rotate and
      // breathe in updateFx, so stars read as live suns rather than a
      // static lit disc with a glow blob behind it. Point stars get the
      // same corona inside the near-field group — hidden at range with
      // the photosphere it belongs to.
      const coronaTex = coronaFor(THREE, def)

      if (coronaTex) {
        const cm = new THREE.SpriteMaterial(
          matParams({
            map: coronaTex,
            // Tint stays baked in the texture — `color` white keeps the
            // node pipeline from double-multiplying the gold.
            color: SF_COLORS.SUN_LIGHT,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        )

        const coronaSprite = new THREE.Sprite(cm)

        // Activity enlarges the corona — an active star's streamers and
        // eruptions reach farther off the limb than a quiet dwarf's.
        const csize = def.radius * SF_DETAIL.CORONA_SCALE * (def.activity ?? 1)

        coronaSprite.scale.set(csize, csize, 1)

        starHost.add(coronaSprite)

        const crand = lcg(seedFrom(`${def.id}:spin`))

        corona = {
          material: cm as unknown as { rotation: number; opacity: number },
          rate: 0.1 + crand() * 0.25,
          phase: crand() * Math.PI * 2,
        }
      }
    }

    // Solar flares — limb prominence sprites rooted at the photosphere
    // edge; updateFx breathes them with the solar-wind cycle. Point
    // stars carry them inside the approach-gated group (flare stars
    // like Proxima and TRAPPIST-1 resolve with live prominences).
    const flares = def.flares ? makeSolarFlares(THREE, def, glowTex) : undefined

    for (const f of flares ?? []) starHost.add(f.sprite)

    // Companion satellites orbit the non-rotating `center` — attached
    // to the mesh they would inherit the surface spin (companions
    // lapping at the parent's day rate instead of their own periods).
    const satPivots = makeSatellites(THREE, deps, def, center)

    detail.push(...satPivots.map((sat) => sat.pivot))

    // Dossier-backed companions — a satellite carrying `id`/`name` (the
    // ISS) registers as a real pickable body: the station model gets an
    // invisible proxy bubble (a 5-core truss is untappable otherwise),
    // an anchor for fly-to, and a minimal node so `pickAt`'s smallest-
    // proxy compare and `selectBody`'s standoff resolve it like any
    // catalog world. Its pivot stays driven by the HOST's satPivots —
    // the synthesized node carries no orbit/speed so tickFrame leaves
    // it alone, and `parent` keeps the galactic rider's hands off.
    for (const [i, sat] of (def.satellites ?? []).entries()) {
      if (!sat.id) continue

      // satPivots is built from the same def.satellites list 1:1.
      const rec = satPivots[i]

      rec.mesh.userData[SF_USER_BODY] = sat.id

      const proxy = makePickProxy(THREE, sat.radius)

      proxy.userData[SF_USER_BODY] = sat.id

      rec.mesh.add(proxy)

      s.pickables.push(rec.mesh)

      s.anchors.set(sat.id, rec.mesh)

      s.nodes.set(sat.id, {
        def: {
          id: sat.id,
          name: sat.name ?? sat.id,
          kind: SF_KINDS.SATELLITE,
          group: def.group,
          radius: sat.radius,
          parent: def.id,
          dist: def.dist,
        },
        pivot: rec.pivot,
        mesh: rec.mesh,
        spinner: rec.mesh,
        satPivots: [],
        detail: [],
      })
    }

    // Belt hero rocks — the group joins the LOD detail list (far view
    // keeps only the particle annulus) and the pivots join satPivots so
    // tickFrame sweeps and tumbles them like every other companion.
    if (beltRockGroup) {
      detail.push(beltRockGroup)

      satPivots.push(...rockPivots)
    }

    // LEO constellation — the Starlink-class swarm rides a single
    // precessing pivot like a satellite (the points carry their own
    // inclined-orbit positions inside the holder frame).
    const swarm = def.constellation ? makeConstellation(THREE, def) : null

    if (swarm) {
      const holder = new THREE.Object3D()

      holder.add(swarm)
      center.add(holder)

      satPivots.push({
        pivot: holder,
        mesh: swarm,
        speed: SF_CONSTELLATION.SPEED,
        phase: 0,
        orbit: 0,
      })

      detail.push(holder)
    }

    // Meteor strikes — pooled flash sprites on cratered airless bodies;
    // updateFx schedules and fades the impacts.
    const meteorPool = def.meteors ? makeMeteorPool(THREE, def, glowTex) : undefined

    for (const slot of meteorPool ?? []) mesh.add(slot.sprite)

    const anchor = def.parent ? s.anchors.get(def.parent) : s.world

    if (anchor) anchor.add(pivot)

    const node: SFNode = {
      def,
      pivot,
      mesh,
      center,
      spinner: spinner ?? mesh,
      rotor,
      lock,
      satPivots,
      detail,
      corona,
      flares,
      meteorPool,
      meteorNext: def.meteors ? 2 + Math.random() * 4 : undefined,
      farGlow,
      farPick,
      farGlyph,
    }

    s.nodes.set(def.id, node)
    // Anchors resolve the body-system center — the same world point as
    // the mesh but free of spin/lock rotation, so parented bodies and
    // the fly-to camera key off the orbit position alone.
    s.anchors.set(def.id, center)

    // Hierarchy shells and small-body belts never enter the raycast
    // set — the enormous boundary spheres and the thousands of pebble
    // particles would intercept every pointer ray in the scene.
    if (def.kind !== SF_KINDS.STRUCTURE && def.kind !== SF_KINDS.BELT) {
      s.pickables.push(pickMesh ?? mesh)
    }
  }

  mountGalacticRider(s, THREE)

  // Re-parent the sun stand-in light onto the Sun anchor — the floating
  // origin pins whichever body is followed at the origin, so a
  // scene-rooted light would sit inside that body rather than shining
  // from the Sun's real position.
  const sunAnchor = s.anchors.get(SF_BODY_IDS.SUN)

  if (sunAnchor && s.sunLight) sunAnchor.add(s.sunLight)
}

/**
 * Galactic co-rotation — the solar system and its stellar neighborhood
 * are not stationary: the real Galaxy carries the Sun around the
 * galactic centre, so everything heliocentric must ride the Milky
 * Way's rotating disc as one structure. This mounts a rider group on
 * the disc's spin target at the Sun's true local ring position, then
 * re-parents every unparented node whose whole extent fits inside
 * SF_SCALE.CO_ROTATE_R — the Sun's pivot (which carries the planets,
 * their satellites, and later the deep-field star cloud), orbiting
 * bodies pivoted at the origin, the named-star neighborhood, and the
 * local hierarchy shells. Because the carved heliocentric bubble lives
 * in the same rotating frame, it stays locked on the Sun forever — the
 * earlier static-outer-disc workaround is no longer needed.
 * The rider counter-tilts its own X so children keep their ecliptic
 * orientation (the solar system's plane is not the galactic plane).
 * @param s Engine state (nodes map must be fully populated).
 * @param THREE The three.js module.
 */
function mountGalacticRider(s: SFState, THREE: ThreeModule): void {
  const mw = s.nodes.get(SF_BODY_IDS.MILKY_WAY)

  if (!mw || !mw.def.pos) return

  const rider = new THREE.Group()

  // The Sun's position in the disc's LOCAL frame — the same inverse
  // transform the heliocentric bubble uses: negate the disc centre's
  // world offset, then un-rotate the disc tilt about X. For the MW's
  // (−267,0,0) centre this lands at (+267,0,0) — the Sun's true 0.51R
  // ring on the disc's X axis (invariant under the tilt itself).
  const a = -Math.PI / 2 + (mw.def.tilt ?? 0)

  const wy = -mw.def.pos[1]

  const wz = -mw.def.pos[2]

  rider.position.set(
    -mw.def.pos[0],
    wy * Math.cos(-a) - wz * Math.sin(-a),
    wy * Math.sin(-a) + wz * Math.cos(-a)
  )

  // Undo the disc tilt for rider children — the ecliptic is ~60° off
  // the galactic plane, so heliocentric pivots keep world axes while
  // still orbiting the galactic pole with the disc.
  rider.rotation.x = -a

  mw.spinner.add(rider)

  for (const node of s.nodes.values()) {
    const def = node.def

    // Parented bodies already live in their host's frame (Sgr A* rides
    // the MW group directly); the disc itself never adopts itself.
    if (node === mw || def.parent) continue

    const px = def.pos?.[0] ?? 0
    const py = def.pos?.[1] ?? 0
    const pz = def.pos?.[2] ?? 0

    // The body's whole extent (orbit sweep, shell radius, or body size)
    // must fit inside the co-rotation bubble — partially-contained
    // structures like the observable-universe shell stay world-fixed.
    const extent = Math.max(def.orbit ?? 0, def.structure?.radius ?? 0, def.radius)

    if (Math.hypot(px, py, pz) + extent > SF_SCALE.CO_ROTATE_R) continue

    // three.js re-parents automatically; pivot.position is already
    // heliocentric (rider origin = the Sun's local position).
    rider.add(node.pivot)
  }
}
