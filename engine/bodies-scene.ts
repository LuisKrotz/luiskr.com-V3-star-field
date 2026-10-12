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
    let vis = def
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
      // — no sphere mesh at all: an invisible pick bubble + the point
      // halo (added below) carry the body, so no marker can ever render
      // as a planet-like ball beside another body. The authored
      // `def.radius` keeps driving the luminosity halo, the pick proxy
      // and the fly-to standoff; satellites/corona scale to the point.
      const pointStar =
        (def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM) &&
        def.group !== SF_GROUPS.SOLAR &&
        def.radius > SF_DETAIL.POINT_RADIUS

      if (pointStar) {
        const k = SF_DETAIL.POINT_RADIUS / def.radius

        vis = {
          ...def,
          radius: SF_DETAIL.POINT_RADIUS,
          satellites: def.satellites?.map((sat) => ({
            ...sat,
            radius: sat.radius * k,
            orbit: sat.orbit * k,
          })),
        }

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

    if (def.orbit != null) {
      mesh.position.x = def.orbit

      pivot.rotation.y = def.phase ?? 0
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
    // hemispheres over the year — real seasons. Parent-mounted bodies
    // (moons) keep the legacy in-orbit tilt: their spin is tidal anyway.
    const useAxisLock = !!(sphereTilt && def.orbit != null && !def.parent)

    if (useAxisLock) {
      lock = new THREE.Group()
      lock.rotation.z = def.tilt as number
      pivot.add(lock)
      lock.add(mesh)
    } else {
      pivot.add(mesh)

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

    if (def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM) {
      mesh.add(makeStarHalo(THREE, def, glowTex, vis !== def))

      // Corona sprite — seeded streamers + flare knots that rotate and
      // breathe in updateFx, so stars read as live suns rather than a
      // static lit disc with a glow blob behind it. Point stars (vis
      // clamped) skip it — a corona around a sphere-less marker is just
      // a second halo, so the point glow does the work alone.
      const coronaTex = vis === def ? coronaFor(THREE, def) : undefined

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
        const csize = vis.radius * SF_DETAIL.CORONA_SCALE * (def.activity ?? 1)

        coronaSprite.scale.set(csize, csize, 1)

        mesh.add(coronaSprite)

        const crand = lcg(seedFrom(`${def.id}:spin`))

        corona = {
          material: cm as unknown as { rotation: number; opacity: number },
          rate: 0.1 + crand() * 0.25,
          phase: crand() * Math.PI * 2,
        }
      }
    }

    // Solar flares — limb prominence sprites rooted at the photosphere
    // edge; updateFx breathes them with the solar-wind cycle.
    const flares = def.flares && vis === def ? makeSolarFlares(THREE, def, glowTex) : undefined

    for (const f of flares ?? []) mesh.add(f.sprite)

    const satPivots = makeSatellites(THREE, deps, vis, mesh)

    detail.push(...satPivots.map((sat) => sat.pivot))

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
      mesh.add(holder)

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
      spinner: spinner ?? mesh,
      rotor,
      lock,
      satPivots,
      detail,
      corona,
      flares,
      meteorPool,
      meteorNext: def.meteors ? 2 + Math.random() * 4 : undefined,
    }

    s.nodes.set(def.id, node)
    s.anchors.set(def.id, mesh)

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
