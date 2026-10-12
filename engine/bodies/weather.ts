/**
 * @file engine/bodies/weather.ts
 * @description Living-planet systems — everything that makes Earth (and
 * the wind-touched giants) read as active worlds instead of static
 * spheres:
 *
 *   weather      — a fully procedural cloud deck: evolving fbm coverage
 *                  steered by the real 8k cloud map, latitude-banded
 *                  differential rotation (jet streams), the ITCZ
 *                  convergence band migrating with the solar declination
 *                  (monsoons), seeded hurricane vortices with spiral arms
 *                  and calm eyes, seasonal polar snow advance/retreat,
 *                  and a periodically erupting volcanic ash plume. The
 *                  same field also drives the surface material's cloud
 *                  shadows (day side only).
 *   aurora       — polar emission curtains fed by the shared solar-wind
 *                  uniform; a storm on the Sun ignites auroras on every
 *                  atmosphere-bearing planet at once.
 *   constellation— the Starlink-class LEO shell: dozens of lit specks
 *                  sharing one inclined orbital plane sweeping as a unit.
 *   flares       — the Sun's limb prominences: sprites that breathe and
 *                  stretch into space with the wind cycle.
 *
 * All materials are TSL node materials (WebGPURenderer path); the math
 * constants live in `tokens/starfield/params/weather.ts`.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL, SF_SCENE } from '@core/tokens/starfield/params.js'
import {
  SF_WEATHER,
  SF_AURORA,
  SF_CONSTELLATION,
  SF_METEOR,
} from '@core/tokens/starfield/params.js'
import { matParams } from '../materials.js'
import { lcg, seedFrom } from '../rand.js'
import type { SFBodyDef, SFNodeDeps } from '../types.js'

type ThreeModule = typeof import('three')
type TslNs = SFNodeDeps['TSL']

/**
 * TSL node shorthand — the fluent node graph (`.mul().add()…`) is fully
 * dynamic; one file-local alias keeps the builder readable instead of
 * fighting per-call generics.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** Live uniform handle shared between the builders and updateFx. */
export interface SFWeatherUniforms {
  /** Scene-seconds uniform — updateFx writes `s.t` into `.value`. */
  time: { value: number }
}

/**
 * Rotates position `p` around axis `k` by angle `a` — Rodrigues'
 * rotation formula: p·cos a + (k×p)·sin a + k·(k·p)·(1−cos a). Used to
 * swirl the weather sample point around each hurricane's eye axis.
 */
const rodrigues = (p: N, k: N, a: N): N => {
  const c = a.cos()

  const s = a.sin()

  return p
    .mul(c)
    .add(k.cross(p).mul(s))
    .add(k.mul(k.dot(p)).mul(c.oneMinus()))
}

/**
 * The shared weather field — returns { density, ash, snow, day } nodes
 * sampled at `positionLocal`, so the cloud deck and the surface shadow
 * read the SAME sky in the same frame. `positionLocal` is object space,
 * meaning the field co-rotates with the body while the internal drift
 * terms add the atmosphere's own differential motion on top.
 * @param TSL three/tsl namespace.
 * @param time Shared time uniform (scene seconds).
 * @param sunDirU Shared sun-direction uniform node — its Y doubles as
 *   solar declination for seasons/monsoon migration.
 * @param cloudTex The real 8k cloud map steering large-scale coverage.
 * @returns Field nodes: cloud density, ash darkness, snow cover, dayF.
 */
function weatherField(TSL: TslNs, time: N, sunDirU: N, cloudTex: THREE_NS.Texture) {
  const {
    mx_fractal_noise_float: fbm,
    normalize,
    vec2,
    vec3,
    texture,
    smoothstep,
    atan,
    float,
    dot,
  } = TSL

  const W = SF_WEATHER

  const p: N = normalize(TSL.positionLocal)

  const lat: N = p.y

  const decl: N = sunDirU.y

  // Differential rotation — air masses shear against the surface:
  // equatorial superrotation base plus a mid-latitude jet boost.
  const ang = time.mul(W.JET_BASE).add(time.mul(W.JET_LAT).mul(lat.abs()))

  const pr: N = vec3(
    p.x.mul(ang.cos()).sub(p.z.mul(ang.sin())),
    p.y,
    p.x.mul(ang.sin()).add(p.z.mul(ang.cos()))
  )

  // Spherical UV of the rotated sample — the real cloud map steers WHERE
  // weather lives (oceanic bands vs land) while fbm evolves it in time.
  const u = atan(pr.z, pr.x)
    .mul(0.5 / Math.PI)
    .add(0.5)

  const v = lat
    .asin()
    .mul(1 / Math.PI)
    .add(0.5)

  // Mirror the longitude coordinate — the source cloud map isn't
  // tileable, so a fold (u → 1−|2u−1|) removes the hard wrap seam
  // down the meridian at the cost of mirroring half the map.
  const uM = u.mul(2).sub(1).abs().oneMinus()

  const steer = texture(cloudTex, vec2(uM, v)).r

  // Latitude meander — slow large-scale noise warps the coverage sample
  // poleward/equatorward so jet-sheared banks weave instead of ringing
  // the globe in straight east-west stripes.
  const prW = pr.add(
    vec3(
      0,
      fbm(vec3(p.x.mul(2.2), time.mul(W.CLOUD_EVOLVE * 0.7), p.z.mul(2.2))).mul(W.LAT_MEANDER),
      0
    )
  )

  // Base cover — large-scale evolving fbm steered by the real map…
  const coverLo = fbm(
    prW.mul(W.CLOUD_FREQ).add(vec3(time.mul(W.CLOUD_EVOLVE), 0, time.mul(W.CLOUD_EVOLVE * 0.6)))
  )

  // …plus a detail octave at ~4× frequency that shreds the banks into
  // clumpy cauliflower clusters — without it the deck reads as smooth
  // latitude stripes, not clouds.
  const coverHi = fbm(
    prW
      .mul(W.CLOUD_FREQ * W.CLOUD_DETAIL_FREQ)
      .add(vec3(time.mul(W.CLOUD_EVOLVE * 1.7), 0, time.mul(W.CLOUD_EVOLVE)))
  )

  const cover = coverLo.mul(1 - W.CLOUD_DETAIL_GAIN).add(coverHi.mul(W.CLOUD_DETAIL_GAIN))

  let dens: N = smoothstep(W.COVER_LO, W.COVER_HI, cover.mul(0.65).add(steer.mul(W.CLOUD_STEER)))

  // ITCZ — the equatorial convergence band; its latitude follows the
  // solar declination so the monsoon belt migrates with the seasons.
  const itczDetail = fbm(pr.mul(W.CLOUD_FREQ * 2.5).add(vec3(time.mul(W.CLOUD_EVOLVE * 2), 0, 0)))

  dens = dens.add(
    // GLSL smoothstep needs lo<hi edges — the inverted falloff is
    // written as oneMinus(smoothstep(lo, hi, d)).
    smoothstep(W.ITCZ_HALF * 0.3, W.ITCZ_HALF, lat.sub(decl.mul(W.ITCZ_WANDER)).abs())
      .oneMinus()
      .mul(W.ITCZ_GAIN)
      .mul(float(0.55).add(itczDetail.mul(0.45)))
  )

  // Hurricanes — seeded tropical vortices. Each swirls the sampling
  // position around its own axis so the feeder bands wrap the core
  // instead of painting a static blob; the eye punches a calm hole.
  const srand = lcg(seedFrom('earth:storms'))

  for (let i = 0; i < W.STORM_N; i++) {
    const sLat = (i % 2 ? 1 : -1) * (0.24 + srand() * 0.2)

    const sLon = srand() * Math.PI * 2

    // Storm centers walk slowly around their tropical band.
    const lon = float(sLon)
      .add(time.mul(W.STORM_DRIFT * (i % 2 ? 3 : -3)))
      .mod(Math.PI * 2)

    const vc = vec3(
      lon.cos().mul(Math.cos(sLat)),
      float(Math.sin(sLat)),
      lon.sin().mul(Math.cos(sLat))
    )

    const d = pr.distance(vc)

    const infl = d
      .mul(d)
      .mul(-1 / (W.STORM_R * W.STORM_R))
      .exp()

    const arm = smoothstep(
      0.35,
      0.75,
      fbm(rodrigues(pr, vc, infl.mul(W.STORM_SWIRL)).mul(W.STORM_FREQ))
    )

    dens = dens.add(arm.mul(infl).mul(W.STORM_GAIN))

    dens = dens.sub(
      smoothstep(W.EYE_R * 0.35, W.EYE_R, d)
        .oneMinus()
        .mul(W.EYE_DIP)
        .mul(infl)
    )
  }

  // Seasonal polar snow — the cap edge pushes toward the equator in each
  // hemisphere's winter (declination swings the line opposite ways).
  // NB: `decl` is a node — `number * node` is a JS-side NaN, so the
  // arithmetic must stay inside node methods.
  const declAmp = decl.mul(W.ICE_DECL)

  const iceN = float(W.ICE_BASE).sub(declAmp)

  const iceS = float(W.ICE_BASE).add(declAmp)

  const snow = smoothstep(iceN, iceN.add(W.ICE_SOFT), lat).add(
    smoothstep(iceS, iceS.add(W.ICE_SOFT), lat.negate())
  )

  dens = dens.add(snow.mul(W.SNOW_GAIN))

  // Volcanic ash — a seeded eruption site pulses on a slow cycle; the
  // plume darkens the deck locally (ash is a color term, not cover).
  const vrand = lcg(seedFrom('earth:volcano'))

  const vp = vec3(
    Math.cos(vrand() * Math.PI * 2) * 0.8,
    (vrand() - 0.5) * 0.9,
    Math.sin(vrand() * Math.PI * 2) * 0.8
  )

  const vph = time.mul(1 / W.VOLC_PERIOD).mod(1)

  const pulse = smoothstep(0, 0.18, vph).mul(smoothstep(0.55, 1, vph).oneMinus())

  const ash = smoothstep(W.VOLC_R * 0.3, W.VOLC_R, pr.distance(vp))
    .oneMinus()
    .mul(pulse)
    .mul(W.VOLC_GAIN)

  // Day factor — clouds can't shadow the night side (city lights must
  // stay visible through the deck).
  const dayF = smoothstep(-0.05, 0.25, dot(TSL.normalLocal, sunDirU))

  return { dens, ash, snow, dayF }
}

/**
 * Builds the living cloud deck + applies the matching surface shadow —
 * a lit MeshStandardNodeMaterial so the deck takes real sun shading
 * (bright limb, dark night side, true terminator) instead of the old
 * additive white wash. `surfaceMat` gets a colorNode multiplying the
 * day-side diffuse by `1 − SHADOW·density` so thick weather visibly
 * dims the ground beneath it. The shared `fxTime` uniform drives field
 * evolution (updateFx writes it once per frame).
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors.
 * @param def Catalog entry (radius sizes the shell).
 * @param cloudTex Loaded 8k cloud map (coverage steering).
 * @param sunDir Shared day/night sun-direction vector.
 * @param surfaceMat The body's surface material (node path only).
 * @param time Shared scene-time uniform node (`s.fxTime`).
 */
export function makeWeatherClouds(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  cloudTex: THREE_NS.Texture,
  sunDir: THREE_NS.Vector3,
  surfaceMat: unknown,
  time: { value: number }
): THREE_NS.Object3D | null {
  const StdCtor = deps.mats.MeshStandardNodeMaterial

  if (!StdCtor) return null

  const { TSL } = deps

  const sunU = TSL.uniform(sunDir)

  const field = weatherField(TSL, time, sunU, cloudTex)

  const geo = new THREE.SphereGeometry(
    def.radius * SF_DETAIL.CLOUD_SCALE,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new StdCtor(
    matParams({ transparent: true, depthWrite: false, roughness: 1, metalness: 0 })
  )

  const ashC = new THREE.Color(SF_WEATHER.ASH_TINT)

  // Ash plumes darken the deck locally; snow/clear areas stay white.
  mat.colorNode = TSL.mix(
    TSL.vec3(1, 1, 1),
    TSL.vec3(ashC.r, ashC.g, ashC.b),
    field.ash.clamp(0, 1)
  )

  mat.opacityNode = field.dens.clamp(0, 1).mul(SF_DETAIL.CLOUD_OPACITY)

  // Surface cloud shadow — same field, day side only. `colorNode`
  // REPLACES the material's map lookup entirely (it doesn't multiply
  // into it), so the ground texture must be re-sampled here and tinted
  // by the shadow mix — otherwise assigning the node erases the map.
  const surf = surfaceMat as { colorNode?: unknown; map?: THREE_NS.Texture } | null

  const mapTex = surf?.map

  if (surf && typeof surf === 'object' && mapTex) {
    const shade = SF_WEATHER.SHADOW

    surf.colorNode = TSL.texture(mapTex).rgb.mul(
      TSL.mix(
        TSL.vec3(1, 1, 1),
        TSL.vec3(1 - shade, 1 - shade, 1 - shade),
        field.dens.clamp(0, 1).mul(field.dayF)
      )
    )
  }

  return new THREE.Mesh(geo, mat)
}

/**
 * Aurora curtains — a thin rayed emission OVAL centered on the body's
 * MAGNETIC pole (the `tilt` offsets the sampling frame by the dipole
 * angle, so Neptune's wildly offset field draws a swung oval, not a
 * symmetric polar cap). Two shells stack the curtain: the lower ring
 * hugs the atmosphere at SHELL_SCALE, an upper ring at SHELL_SCALE2
 * with poleward-shifted latitude reads as curtain tops standing off
 * the limb. Longitude fbm provides both the oval's substorm buckling
 * and the high-frequency curtain rays; the shared wind uniform gates
 * brightness so a solar storm ignites every aurora-bearing world in
 * the same frame, and the optional sun-direction uniform dims the
 * day-side arc (UV emission runs in sunlight — it just doesn't show).
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors.
 * @param def Catalog entry — `aurora` carries the per-body palette,
 *   magnetic tilt, oval latitude and intensity.
 * @param time Shared time uniform node (updateFx-driven).
 * @param wind Shared solar-wind uniform node (updateFx-driven).
 * @param sunDir Shared sun-direction vector when the body registers
 *   one — gates the day-side arc; omit for ungated shells.
 */
export function makeAurora(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  time: { value: number },
  wind: { value: number } | null,
  sunDir?: THREE_NS.Vector3
): THREE_NS.Object3D | null {
  if (!deps.mats.MeshBasicNodeMaterial || !wind) return null

  const { TSL } = deps

  const { mx_fractal_noise_float: fbm, smoothstep, vec3, mix, float, normalize, dot } = TSL

  const cfg = typeof def.aurora === 'object' && def.aurora ? def.aurora : {}

  const tN = time as N

  const wN = wind as N

  // Magnetic frame — rotate the unit normal by the dipole tilt about a
  // seeded azimuth so the oval centers on the magnetic pole. The azimuth
  // is a golden-fraction hash of the body id (deterministic per planet).
  const mg = (seedFrom(`${def.id}:mag`) % 628) / 100

  const axis = vec3(Math.cos(mg), 0, Math.sin(mg))

  const nMag = rodrigues(normalize(TSL.normalLocal), axis, float(cfg.tilt ?? SF_AURORA.TILT))

  const mLat: N = nMag.y.abs()

  // Wavy oval — low-frequency noise buckles the ring with longitude so
  // the curtain arcs wander the way real substorm ovals do.
  const wobble = fbm(
    vec3(
      nMag.x.mul(SF_AURORA.WOBBLE_FREQ),
      tN.mul(SF_AURORA.WOBBLE_DRIFT),
      nMag.z.mul(SF_AURORA.WOBBLE_FREQ)
    )
  ).mul(SF_AURORA.LAT_WOBBLE)

  // Curtain rays — longitude striation: sin(lon·N) gives N pleats
  // around the oval (seam-free for integer N since sin(±πN)=0), its
  // phase jittered by low-freq noise so the rays waver like hanging
  // drapes, sharpened by a power so bright cores separate from gaps.
  const lon = TSL.atan(nMag.z, nMag.x)

  const jag = fbm(
    vec3(
      nMag.x.mul(SF_AURORA.WOBBLE_FREQ * 2),
      tN.mul(SF_AURORA.RAY_DRIFT),
      nMag.z.mul(SF_AURORA.WOBBLE_FREQ * 2)
    )
  )

  const rays = lon
    .mul(SF_AURORA.RAY_FREQ)
    .add(jag.mul(SF_AURORA.RAY_JAG))
    .add(tN.mul(SF_AURORA.RAY_DRIFT))
    .sin()
    .mul(0.5)
    .add(0.5)
    .pow(SF_AURORA.RAY_SHARP)

  // Arc breakup — one slow low-frequency sweep flares whole sectors of
  // the oval at a time (substorm brightening); high contrast lets dark
  // sectors nearly vanish so a storm never washes the ring flat.
  const arcs = fbm(
    vec3(
      nMag.x.mul(SF_AURORA.ARC_FREQ),
      tN.mul(SF_AURORA.ARC_DRIFT),
      nMag.z.mul(SF_AURORA.ARC_FREQ)
    )
  )
    .mul(0.5)
    .add(0.5)

  const topC = new THREE.Color(cfg.color ?? SF_AURORA.TOP)

  const lowC = new THREE.Color(cfg.colorLow ?? SF_AURORA.LOW)

  const gain = cfg.intensity ?? 1

  // Night gate — day-side emission fades to DAY_FLOOR rather than zero
  // (real UV aurora never fully stops; it just loses contrast).
  const night: N = sunDir
    ? smoothstep(SF_AURORA.NIGHT_HI, SF_AURORA.NIGHT_LO, dot(TSL.normalLocal, TSL.uniform(sunDir)))
        .oneMinus()
        .mul(1 - SF_AURORA.DAY_FLOOR)
        .add(SF_AURORA.DAY_FLOOR)
    : float(1)

  // Hemisphere gate — bodies can restrict the oval to the magnetic
  // north (Earth's boreal curtains); the mask fades the southern oval
  // out across the magnetic equator.
  const hemi: N =
    cfg.south === false ? smoothstep(SF_AURORA.HEMI_LO, SF_AURORA.HEMI_HI, nMag.y) : float(1)

  // Limb fade — |view-space normal z| is 1 looking straight down at the
  // oval and 0 at grazing angles; powering it up kills the telltale
  // arcs a shell ring draws ABOVE the silhouette so the emission only
  // ever reads as a glow lying on the atmosphere.
  const facing = TSL.normalView.z.abs().pow(SF_AURORA.LIMB_POW)

  // Single close-hugging shell — a second elevated ring read as arcs
  // floating off the limb, so the oval lives at SHELL_SCALE only. The
  // curtain's altitude cue comes from ray striation instead.
  const dLat = mLat.sub(float(cfg.lat ?? SF_AURORA.LAT0).add(wobble))

  const ring = dLat
    .mul(dLat)
    .mul(-0.5 / (SF_AURORA.OVAL_W * SF_AURORA.OVAL_W))
    .exp()

  const geo = new THREE.SphereGeometry(
    def.radius * SF_AURORA.SHELL_SCALE,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new deps.mats.MeshBasicNodeMaterial()

  // Palette blend across the oval band — the lower-edge emission
  // (red/violet on Earth) sits equatorward of the curtain top.
  const edgeK = smoothstep(
    (cfg.lat ?? SF_AURORA.LAT0) - SF_AURORA.OVAL_W * 2,
    (cfg.lat ?? SF_AURORA.LAT0) + SF_AURORA.OVAL_W * 2,
    mLat
  )

  mat.colorNode = mix(vec3(lowC.r, lowC.g, lowC.b), vec3(topC.r, topC.g, topC.b), edgeK)

  mat.transparent = true

  mat.opacityNode = ring
    .mul(rays.mul(1 - SF_AURORA.RAY_FLOOR).add(SF_AURORA.RAY_FLOOR))
    .mul(arcs.mul(SF_AURORA.ARC_GAIN).add(1 - SF_AURORA.ARC_GAIN))
    .mul(wN)
    .mul(night)
    .mul(hemi)
    .mul(facing)
    .mul(SF_AURORA.INTENSITY * gain)
    .clamp(0, 1)

  mat.blending = THREE.AdditiveBlending

  mat.depthWrite = false

  mat.side = THREE.DoubleSide

  return new THREE.Mesh(geo, mat)
}

/**
 * Starlink-class constellation — a `count`-point cloud on one inclined
 * orbital shell: each satellite is a single lit pixel glinting as it
 * laps the planet, and the whole shell precesses as a unit on its
 * pivot (frame.ts rotates it like a satellite pivot). Raycast is
 * stubbed so the swarm can never steal a body click.
 * @param THREE The three.js module.
 * @param def Catalog entry — `constellation` carries count/orbit.
 */
export function makeConstellation(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Object3D | null {
  const cfg = def.constellation

  if (!cfg) return null

  const rand = lcg(seedFrom(`${def.id}:constellation`))

  const pos = new Float32Array(cfg.count * 3)

  for (let i = 0; i < cfg.count; i++) {
    const phi = rand() * Math.PI * 2

    const r = def.radius * cfg.orbit * (1 + (rand() - 0.5) * SF_CONSTELLATION.JITTER)

    const inc = SF_CONSTELLATION.INCLINE

    pos[i * 3] = Math.cos(phi) * r
    pos[i * 3 + 1] = Math.sin(phi) * r * Math.sin(inc) + (rand() - 0.5) * r * 0.02
    pos[i * 3 + 2] = Math.sin(phi) * r * Math.cos(inc)
  }

  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))

  const mat = new THREE.PointsMaterial(
    matParams({
      color: SF_COLORS.ISS,
      size: def.radius * SF_CONSTELLATION.SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    })
  )

  const points = new THREE.Points(geo, mat)

  // A starlink glint is one pixel — it must never intercept a body click.
  ;(points as unknown as { raycast: () => void }).raycast = () => {}

  return points
}

/**
 * Solar limb flares — `FLARE_N` seeded prominence sprites rooted at the
 * photosphere edge of the Sun's equatorial band. updateFx scales them by
 * `wind × sin⁴(phase + t·rate)` so eruptions breathe with the activity
 * cycle and spike outward when storms hit.
 * @param THREE The three.js module.
 * @param def Catalog entry (Sun).
 * @param glowTex Shared radial-glow texture for the sprite maps.
 * @returns Flare records for the node's `flares` list.
 */
export function makeSolarFlares(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): Array<{
  sprite: THREE_NS.Object3D
  rate: number
  phase: number
  base: number
}> {
  if (!glowTex) return []

  const rand = lcg(seedFrom(`${def.id}:flares`))

  const flares: Array<{
    sprite: THREE_NS.Object3D
    rate: number
    phase: number
    base: number
  }> = []

  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2

    const m = new THREE.SpriteMaterial(
      matParams({
        map: glowTex,
        color: SF_COLORS.STAR_FLARE,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )

    const sprite = new THREE.Sprite(m)

    // Rooted at the limb, biased to the equatorial band where real
    // prominences cluster.
    sprite.position.set(
      Math.cos(a) * def.radius * 0.96,
      (rand() - 0.5) * def.radius * 0.5,
      Math.sin(a) * def.radius * 0.96
    )

    flares.push({
      sprite,
      rate: 0.25 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
      base: def.radius * (0.35 + rand() * 0.4),
    })
  }

  return flares
}

/**
 * Meteor flash pool — `SF_METEOR.POOL` additive glow sprites parented
 * to the cratered body's mesh, all dormant (opacity 0). updateFx fires
 * a slot at a random surface point when `meteorNext` elapses and fades
 * it over `SF_METEOR.LIFE`, so a body like Callisto reads as still
 * being bombarded — matching the "saturated with craters" dossier —
 * instead of standing geologically dead.
 * @param THREE The three.js module.
 * @param def Catalog entry (meteors-flagged).
 * @param glowTex Shared radial-glow texture for the flash map.
 */
export function makeMeteorPool(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined
): Array<{ sprite: THREE_NS.Object3D; t0: number; active: boolean }> {
  if (!glowTex) return []

  const pool: Array<{ sprite: THREE_NS.Object3D; t0: number; active: boolean }> = []

  for (let i = 0; i < SF_METEOR.POOL; i++) {
    const m = new THREE.SpriteMaterial(
      matParams({
        map: glowTex,
        color: SF_METEOR.COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )

    const sprite = new THREE.Sprite(m)

    const s = def.radius * SF_METEOR.SIZE

    sprite.scale.set(s, s, 1)

    // Stub raycast — a flash must never intercept a body click.
    ;(sprite as unknown as { raycast: () => void }).raycast = () => {}

    pool.push({ sprite, t0: -1, active: false })
  }

  return pool
}
