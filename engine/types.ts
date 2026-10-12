/* istanbul ignore file — type-only declarations, no runtime code. */
/**
 * @file engine/types.ts
 * @description Shared types for the star-field engine — the static body
 * catalog entry, the lazy-loaded dossier JSON shape, the mutable engine
 * state bag threaded through every stage (bootstrap, frame, fly, picking),
 * and the lifecycle callback signatures the host component receives.
 */

import type * as THREE_NS from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type MeshBasicNodeMaterial from 'three/src/materials/nodes/MeshBasicNodeMaterial.js'
import type MeshStandardNodeMaterial from 'three/src/materials/nodes/MeshStandardNodeMaterial.js'
import type { SFRegistryRecord } from './registry.js'

/** The TSL node-graph namespace (compiled to WGSL/GLSL by the renderer). */
type TslNs = typeof import('three/tsl')

/** The lazily-imported `three` module namespace. */
type ThreeModule = typeof import('three')

/**
 * Lazily-loaded node-material context — the renderer is WebGPURenderer
 * (WebGPU or forced-WebGL backend), whose node pipeline rejects classic
 * GLSL ShaderMaterials. Every custom-shaded surface (fresnel limbs,
 * boundary shells, the accretion disc) is therefore built as a node
 * material: bootstrap injects the TSL namespace and the node material
 * ctor so the body builders stay pure/mockable.
 */
export interface SFNodeDeps {
  /** The `three/tsl` module namespace. */
  TSL: TslNs
  /** Node-material constructors re-exported by `three/webgpu`. */
  mats: {
    MeshBasicNodeMaterial: typeof MeshBasicNodeMaterial
    MeshStandardNodeMaterial?: typeof MeshStandardNodeMaterial
  }
}

/**
 * Static catalog entry — everything the scene needs to place a body,
 * declared once per body in catalog.ts. Orbiting bodies set `orbit` +
 * `parent`; fixed deep-sky objects set `pos` directly.
 */
export interface SFBodyDef {
  /** Body id — matches `public/data/<id>.json` and `data-body` attrs. */
  id: string
  /** Display fallback before the dossier JSON loads. */
  name: string
  /** SF_KINDS value — drives badge label + material recipe. */
  kind: string
  /** SF_GROUPS value — navigator drawer bucket. */
  group: string
  /** Visual radius in scene units (compressed chart, not to scale). */
  radius: number
  /** Orbit radius around `parent` — omit for fixed positions. */
  orbit?: number
  /** Id of the body it orbits (default: scene origin). */
  parent?: string
  /** Orbit angular speed multiplier (0 for fixed bodies). */
  speed?: number
  /** Self-rotation speed multiplier. */
  spin?: number
  /** Starting angle on the orbit (radians). */
  phase?: number
  /**
   * Orbital eccentricity 0–1 — when set, the pivot still sweeps the
   * angle uniformly but the mesh's radial distance follows the conic
   * `r = a(1−e²)/(1+e·cos θ)` so the body draws a visible ellipse
   * (Halley-type comets) instead of the default circle. `orbit` reads
   * as the semi-major axis and `phase` as the periapsis longitude.
   */
  ecc?: number
  /** Axial tilt (radians). */
  tilt?: number
  /** SF_TEXTURES key material map — omit for procedural bodies. */
  texture?: string
  /** SF_COLORS hex for procedural material/emissive tint. */
  color?: number
  /**
   * Limb tint override (SF_COLORS hex) — the fresnel mixes toward this
   * at the silhouette instead of the default hot `STAR_RIM`. A darker
   * rim produces limb darkening on resolved star discs (the Sun):
   * we see deeper hotter layers at centre, cooler gas at the limb.
   */
  rim?: number
  /**
   * Corona activity scale (1 = quiet star) — stretches prominences,
   * adds eruption plumes and sunspots, and enlarges the corona sprite.
   * The Sun runs above 1 so its surface reads as an active photosphere.
   */
  activity?: number
  /** Secondary texture for translucent shells (Venus atmosphere, Saturn ring). */
  shellTexture?: string
  /** Shell is a flat ring disc (Saturn) rather than an atmosphere sphere. */
  shellRing?: boolean
  /** Bump/relief map (Earth terrain shading) — lit-materials only. */
  normalTexture?: string
  /** Grayscale elevation map — bumpMap gives terrain real depth relief. */
  bumpTexture?: string
  /** Night-lights emissive map — glows only where the map is lit. */
  emissiveTexture?: string
  /**
   * Atmosphere rim shell (0 = off) — a fresnel-limb translucent sphere
   * just past the surface whose tint migrates day→dusk→night with the
   * sun direction (Earth); the value scales the shell's opacity.
   */
  atmosphere?: number
  /** Cloud deck texture — extra translucent sphere one layer up. */
  cloudTexture?: string
  /** Fixed scene position `[x,y,z]` for non-orbiting deep-sky objects. */
  pos?: [number, number, number]
  /**
   * Procedural spiral galaxy — render the seeded Points disc instead of
   * a flat sprite. `count` is the star-particle target (capped by
   * `SF_SPIRAL.COUNT_MAX`, divided on mobile) standing in for the
   * galaxy's true stellar population; `arms` overrides the arm count.
   * `volumetric` drops the photographic quad entirely (the Milky Way is
   * viewed from inside — a face-on photo is geometrically false) and
   * thickens the particle disc; `elliptical` fills a smooth spheroid
   * for dwarf-spheroidal members that have no spiral structure.
   */
  spiralDisc?: {
    count: number
    arms?: number
    volumetric?: boolean
    elliptical?: boolean
    /** Disc-thickness multiplier on `SF_SPIRAL.THIN`. */
    thick?: number
    /** Arm angular jitter (rad) — overrides `SF_SPIRAL.ARM_JITTER`. */
    jitter?: number
    /** Spherical stellar-halo fraction (0–1) layered over the disc. */
    halo?: number
    /**
     * Heliocentric exclusion bubble radius (chart units) — particles are
     * resampled away from the Sun's position inside the disc so random
     * disc stars never overlap the solar-system meshes (Milky Way only).
     */
    bubble?: number
  }
  /**
   * Relativistic-jet cones on a black-hole body — bipolar additive
   * cylinders along the disc normal sized by `SF_BH`.
   */
  jets?: boolean
  /**
   * Cosmic-hierarchy boundary — a faint translucent shell sphere of
   * `radius` chart units plus an interior speckle cloud standing in for
   * member galaxies. Structures are not raycast-pickable (their shell
   * would swallow every pointer ray); the navigator still flies to them.
   */
  /**
   * Hierarchy structure — `radius` sizes the volume, `speckles` the
   * interior point cloud, `shell: false` suppresses the boundary sphere
   * (speckle-only landmarks: a fresnel bubble at chart scale reads as a
   * fake wall, while the member cloud marks the region honestly).
   */
  structure?: { radius: number; speckles?: number; shell?: boolean }
  /**
   * Small-body annulus (asteroid/Kuiper belt) — `inner`/`outer` are the
   * ring bounds in chart units, `count` the particle budget, `puff` the
   * vertical half-thickness multiplier on `def.radius`. The def's
   * `radius` doubles as the camera-framing value on fly-to; the def's
   * `color` tints the particles. `gapFreq` overrides the Kirkwood-lane
   * modulation frequency (0 = smooth disc, no resonance gaps).
   */
  belt?: { inner: number; outer: number; count: number; puff?: number; gapFreq?: number }
  /**
   * Luminosity pulse — slow breathing scale oscillation for variable
   * stars, pulsars and flaring cores; `period` in seconds, `amp` the
   * ± scale fraction (0.1 = ±10%).
   */
  pulse?: { period: number; amp: number }
  /**
   * Climate cycle — oscillates the surface material tint toward
   * `SF_COLORS.EARTH_ICE` (glaciation winter→summer analogy); `period`
   * in seconds.
   */
  cycle?: { period: number }
  /**
   * Procedural weather — replaces the static `cloudTexture` deck with
   * the full `weather.ts` field: evolving coverage, jet streams, ITCZ
   * monsoon band, hurricane vortices, seasonal snow lines, volcanic
   * ash plumes and matching surface cloud shadows (Earth).
   */
  weather?: boolean
  /**
   * Aurora shell — a thin rayed emission OVAL centered on the magnetic
   * pole (not the spin pole), driven by the shared solar-wind uniform
   * so solar storms light every aurora-bearing body at once (Earth,
   * Jupiter, Saturn, Neptune). Pass `true` for the default Earth-green
   * oxygen palette, or a config object for per-body physics:
   * `color`/`colorLow` are the curtain-top/lower-edge emissions,
   * `tilt` the magnetic dipole's offset from the spin axis (radians —
   * Neptune's is ~0.82 rad ≈ 47°), `lat` the oval's |lat| center and
   * `intensity` a brightness multiplier (Jupiter > Earth > Saturn >
   * Neptune, matching real emitted power).
   */
  aurora?:
    | boolean
    | {
        color?: number
        colorLow?: number
        tilt?: number
        lat?: number
        intensity?: number
      }
  /**
   * Solar flares — limb prominence sprites on the photosphere edge that
   * breathe and stretch outward with the shared solar-wind cycle (Sun).
   */
  flares?: boolean
  /**
   * LEO constellation shell — `count` point glints sharing one inclined
   * orbital plane at `orbit`× radius, sweeping as a unit (the Starlink
   * swarm; `orbit` multiplies `def.radius`).
   */
  constellation?: { count: number; orbit: number }
  /**
   * Meteor strikes — airless cratered bodies still take impacts; a
   * pooled flash sprite fires at a random surface point every
   * `SF_METEOR.INTERVAL`-ish seconds (updateFx). For bodies whose
   * dossier describes ongoing bombardment — the flash makes the
   * crater record readable as a live process.
   */
  meteors?: boolean
  /**
   * Authored distance label for the hover tooltip — semi-major axis in
   * AU for Solar-System bodies, light-years for deep-sky objects. Units
   * are universal abbreviations so the string needs no translation.
   */
  dist: string
  /**
   * Decorative non-pickable satellites (companion stars, exoplanets) —
   * orbit this body's mesh; purely visual, no dossier of their own.
   */
  satellites?: Array<{
    radius: number
    orbit: number
    speed: number
    color?: number
    texture?: string
    phase?: number
    /**
     * Crafted-station flag — renders the companion as a lit truss +
     * solar-panel model (the ISS silhouette) instead of the default
     * fresnel glow ball, so crewed orbiters read as built objects,
     * not second moons.
     */
    station?: boolean
    /** Same conic rule as `SFBodyDef.ecc` — radial distance modulates
     *  around the circular pivot sweep. */
    ecc?: number
  }>
}

/**
 * One media asset inside a dossier — the file lives under
 * `public/media/<id>/` and renders with caption + credit (NASA/ESA/…
 * attribution is required by the sources' usage terms).
 */
export interface SFDossierMedia {
  /** Asset path relative to `SF_DATA_BASE`-adjacent media root. */
  src: string
  /** Localized caption/alt text. */
  caption?: string
  /** Credit line (e.g. "NASA/JPL-Caltech/MSSS"). */
  credit?: string
  /** Poster frame for videos (relative path). */
  poster?: string
}

/**
 * Provenance signature — when the dossier's source data was acquired
 * and when this locale's translation was produced (ISO dates), plus
 * the reference URLs the facts were paraphrased from.
 */
export interface SFDossierMeta {
  /** ISO date the source data/media was downloaded. */
  acquired: string
  /** ISO date this locale's text was translated/written. */
  translated: string
  /** The locale this file serves (`en` for the canonical file). */
  locale: string
  /** Reference URLs the dossier paraphrases (NASA/JPL/Trek/SVS/ESO). */
  refs?: string[]
}

/**
 * A named prose section — dossiers with `sections` render the deep
 * history as titled subsections (formation, exploration, geology, …)
 * instead of one flat paragraph.
 */
export interface SFDossierSection {
  title: string
  body: string
}

/**
 * Lazy-loaded dossier JSON shape — `public/data/<locale>/<id>.json`.
 * Facts render as a definition list; `history`/`sections` are prose;
 * `source` credits the data provenance (NASA, ESO, …); `media` is a
 * curated gallery; `meta` carries the acquisition/translation signature.
 */
export interface SFDossier {
  id: string
  name: string
  kind: string
  tagline: string
  facts: Array<{ label: string; value: string }>
  history: string
  source: string
  /** Optional prose subsections for deep-history bodies. */
  sections?: SFDossierSection[]
  /** Downloaded gallery — images, videos, audio recordings. */
  media?: {
    images?: SFDossierMedia[]
    videos?: SFDossierMedia[]
    audio?: SFDossierMedia[]
  }
  /** Acquisition/translation signature. */
  meta?: SFDossierMeta
}

/**
 * Raw `public/data/<locale>/<id>.json` file shape — each locale folder
 * ships one self-contained dossier per body so only the active language
 * downloads; `id`, `kind` and `source` are locale-neutral.
 */
export interface SFDossierFile extends SFDossier {
  /**
   * Locale-neutral proper-named star table shipped inside
   * `en/milky-way.json` — real HYG catalogue entries (heliocentric
   * light-years) kept for future labels and the browse index.
   */
  namedStars?: Array<{
    name: string
    x: number
    y: number
    z: number
    mag: number
    spect: string
    con: string
    dist_ly: number
  }>
}

/** Progress callback — loader overlay message + 0–100 percent. */
export type SFProgressFn = (msg: string, pct: number) => void

/** Body-approach/select notification — the host fetches the dossier JSON. */
export type SFBodyFn = (bodyId: string) => void

/**
 * Mutable engine state — one bag threaded through bootstrap/frame/fly so
 * every stage shares renderer, scene graph, tweens and dispose flags
 * without a class field soup.
 */
export interface SFState {
  /** Persistent canvas the host owns (replaced on renderer retry). */
  canvas: HTMLCanvasElement | null
  /** three.js WebGPURenderer (WebGPU or forced-WebGL backend). */
  renderer: { render(...args: unknown[]): unknown; dispose(): void } | null
  /**
   * RenderPipeline post chain (scene → +bloom → vignette → film grain) —
   * null when the pipeline failed to build or the backend rejected it;
   * the frame loop falls back to `renderer.render(scene, camera)` in
   * that case, losing post FX but never the scene.
   */
  pipeline: { render(...args: unknown[]): unknown; dispose(): void } | null
  scene: THREE_NS.Scene | null
  /**
   * Floating-origin world root — every catalog body, cloud and rider
   * parents under this group instead of the scene directly. The follow
   * step counter-translates it so the followed anchor sits at the world
   * origin: rider-mounted bodies translate up to ~16k units/s on the
   * galactic ring, which would otherwise push all coordinates to ~6.7M
   * where float32 quantization (±0.5 units) visibly jitters every mesh.
   * Skybox and lights stay on the scene at the origin — the pin point —
   * so they always enclose/light whatever the camera follows.
   */
  world: THREE_NS.Object3D | null
  /**
   * Sun stand-in point light — created in the scene at the origin (the
   * pin point), then re-parented onto the Sun anchor once bodies build
   * so it keeps illuminating from the Sun's real position whichever
   * body the floating origin currently pins.
   */
  sunLight: THREE_NS.Object3D | null
  camera: THREE_NS.PerspectiveCamera | null
  controls: OrbitControls | null
  /** id → runtime body node record. */
  nodes: Map<string, SFNode>
  /** id → center Object3D the camera targets (equals mesh for most). */
  anchors: Map<string, THREE_NS.Object3D>
  /** Pickable meshes for raycasting. */
  pickables: THREE_NS.Object3D[]
  /**
   * Day/night shader registry — bodies with sun-direction-dependent
   * shading (night-lights emissive gating, atmosphere rim shells).
   * Each frame `updateDayNight` writes `dir = normalize(sunPos −
   * bodyPos)` into the shared vector the material's TSL uniform wraps,
   * so lights stay dark on the lit hemisphere and the rim migrates
   * with the terminator.
   */
  dayNight: Array<{ anchor: THREE_NS.Object3D; dir: THREE_NS.Vector3 }>
  /** ids whose dossier was already prefetched — approach fires once. */
  approached: Set<string>
  /**
   * Shared solar-wind uniform — `updateSolarWind` writes the 0–1+
   * activity level each frame; aurora shells, the sun's flare sprites
   * and the corona breathe with it so a storm visibly propagates from
   * the Sun to every atmosphere-bearing planet. TSL uniform node
   * (runtime `.value`), null until bootstrap creates it.
   */
  solarWind: { value: number } | null
  /**
   * Shared scene-time uniform (scene seconds) — the weather field,
   * aurora curtains and any other TSL effect reads this instead of
   * baking `s.t` so a single per-frame write animates every shader.
   */
  fxTime: { value: number } | null
  /**
   * Real-star cloud Points (HYG catalogue field on the Milky Way disc)
   * — set by star-cloud.ts once the packed binary decodes; kept on
   * state so destroy() can dispose its geometry/material.
   */
  starCloud: THREE_NS.Object3D | null
  /** Guard flag — the star-cloud fetch fires only once per boot. */
  starCloudLoading: boolean
  /**
   * Post-boot handles kept for lazy registry-body spawns — the deep
   * catalog's 139k records are plain cloud points until selected, when
   * `registry-body.ts` builds a real textured mesh on demand. Bootstrap
   * stashes the three module, node-material deps and the shared glow
   * sprite here so spawn code never re-imports lazily-loaded modules.
   */
  THREE: ThreeModule | null
  deps: SFNodeDeps | null
  /** Shared soft-disc sprite — registry halos reuse it, never own it. */
  glowTex: THREE_NS.Texture | null
  /**
   * Spawned registry bodies (`star-NNNNNN`… → Object3D) mounted on the
   * Sun's pivot — an LRU map capped at `SF_STAR_CLOUD.BODY_CACHE` so a
   * long browsing session never accumulates 139k meshes.
   */
  registryBodies: Map<string, THREE_NS.Object3D>
  /** Active fly-to tween or null when controls are free. */
  fly: SFFly | null
  /** Active RAF id. */
  animId: number | null
  /** Set by destroy() — every async stage checks before continuing. */
  disposed: boolean
  /** Bootstrap failed or bailed — host swaps in the CSS fallback. */
  failed: boolean
  /** Reduced-motion flag — pauses the RAF loop. */
  reduced: boolean
  /** Resize listener to detach on destroy. */
  onResize: (() => void) | null
  /** Pointer listeners to detach on destroy. */
  onPointerDown: ((e: Event) => void) | null
  onPointerMove: ((e: Event) => void) | null
  onPointerUp: ((e: Event) => void) | null
  onWheel: ((e: Event) => void) | null
  /** last pointer-down position for click-vs-drag discrimination. */
  downXY: { x: number; y: number } | null
  /** Last tick timestamp for dt-based animation. */
  lastT: number
  /** Elapsed scene time (seconds) — drives orbits/spins. */
  t: number
  /** Camera hover state — last picked body id for the HUD. */
  hoverId: string | null
  /**
   * Navigator-hover position hint — while the pointer (or focus) rests
   * on a catalog row the engine reports the body's projected screen
   * position every tick, edge-clamped so the hint works at any zoom
   * level. Plain data, resolved per tick in `trackHover`: catalog ids
   * carry their `anchor` (live world position) and registry rows carry
   * their shard `rec` (resolved via `registryWorldPos` in the pinned
   * frame). Null when no nav row is hovered; takes precedence over
   * `hoverId` (the pointer is on the drawer, not the canvas).
   */
  hint: {
    id: string
    anchor: THREE_NS.Object3D | null
    rec: SFRegistryRecord | null
  } | null
  /** Selected body id (panel open). */
  selectedId: string | null
  /**
   * Camera-follow anchor — which catalog id the camera rides with when
   * no fly tween runs. Selections set it to the picked body; the solar
   * overview sets it to the Sun so the chart holds the solar system
   * while it orbits inside the galactic disc — without marking a
   * dossier selection. Null = free camera.
   */
  followId: string | null
  /** Lifecycle callbacks from the host. */
  onReady?: () => void
  onProgress?: SFProgressFn
  onSelect?: SFBodyFn
  onApproach?: SFBodyFn
  onHover?: (bodyId: string | null) => void
  /**
   * Per-frame hover tracking — fires every tick while a body is hovered
   * with its projected canvas-space pixel position, so the tooltip and
   * its leader line follow orbiting bodies without DOM thrash. `edge`
   * marks the projected point as clamped to the canvas edge (object
   * off-screen or behind) and `angle` carries the outward direction in
   * degrees for the leader-line arrow.
   */
  onHoverMove?: (bodyId: string, x: number, y: number, edge?: boolean, angle?: number) => void
  /** Fires once when a frame throws — host swaps to the 2D fallback. */
  onLost?: () => void
}

/** Per-body runtime node — pivot (orbit rotation), mesh, and its def. */
export interface SFNode {
  def: SFBodyDef
  /** Object3D that orbits — rotates around the parent's center. */
  pivot: THREE_NS.Object3D
  /** The pickable mesh/sprite — carries `userData.bodyId`. */
  mesh: THREE_NS.Object3D
  /** Spin target (mesh or its inner group) for self-rotation. */
  spinner: THREE_NS.Object3D
  /**
   * Inertial axis lock — a group between the orbit pivot and the mesh
   * carrying `rotation.z = tilt` and counter-rotated on Y each frame.
   * Without it the pivot's orbital Y-rotation precesses the spin axis
   * with the body's position (perpetual solstice); the lock keeps the
   * axis fixed in the parent frame so the terminator sweeps the
   * hemispheres over the orbit — real seasons. Only set on directly
   * orbiting tilted bodies.
   */
  lock?: THREE_NS.Object3D
  /**
   * Differential-rotation subgroup — a volumetric galaxy's inner-disc
   * Points cloud; tickFrame spins it at ROTOR_DIFF× the whole-disc rate
   * so the core laps the rim the way real rotation curves do.
   */
  rotor?: THREE_NS.Object3D
  /**
   * Cloud-deck shell — Earth's cloud sphere rides inside `mesh` so it
   * inherits surface spin; with `def.weather` the deck is the
   * procedural field (jets/storms/snow evolve in the shader via the
   * shared `fxTime` uniform), and updateFx still adds its legacy
   * differential drift for static-texture decks.
   */
  clouds?: THREE_NS.Object3D
  /**
   * Solar limb flares — prominence sprites from `makeSolarFlares`;
   * updateFx scales/opacities them by `solarWind × sin⁴(t·rate+phase)`
   * so eruptions breathe and spike outward when a storm hits.
   */
  flares?: Array<{
    sprite: THREE_NS.Object3D
    rate: number
    phase: number
    base: number
  }>
  /**
   * Meteor flash pool — `SF_METEOR.POOL` sprites parented to the mesh,
   * recycled across strikes so impact flashes never allocate per frame;
   * `meteorNext` schedules the next strike (scene seconds).
   */
  meteorPool?: Array<{
    sprite: THREE_NS.Object3D
    /** Strike start time (scene seconds) — drives the fade curve. */
    t0: number
    active: boolean
  }>
  /** Next scheduled meteor strike time (scene seconds). */
  meteorNext?: number
  /** Satellite pivots (decorative companions) — rotate per frame. */
  satPivots: Array<{
    pivot: THREE_NS.Object3D
    /** Satellite mesh riding the pivot — modulated when `ecc` is set. */
    mesh: THREE_NS.Object3D
    speed: number
    phase: number
    /** Semi-major axis (chart units) + eccentricity for elliptical orbits. */
    orbit: number
    ecc?: number
    /**
     * Self-tumble rate — belt hero rocks spin their own mesh on top of
     * the orbit sweep so debris reads as tumbling rubble, not rails.
     */
    spin?: number
  }>
  /**
   * LOD-toggleable secondary geometry — atmosphere shells, ring discs,
   * satellite pivots; frame.ts hides these
   * beyond the detail distance so far bodies draw as one primitive.
   */
  detail?: THREE_NS.Object3D[]
  /**
   * Star corona sprite — the seeded streamer texture from
   * `procedural.coronaFor`; updateFx rotates `material.rotation` and
   * breathes `material.opacity` so stars shimmer like live suns.
   */
  corona?: { material: { rotation: number; opacity: number }; rate: number; phase: number }
}

/** Active camera fly-to tween — cubic ease-in-out over FLY_MS. */
export interface SFFly {
  /** Start time (performance.now snapshot). */
  t0: number
  /** Camera position at tween start. */
  fromPos: { x: number; y: number; z: number }
  /** Approach offset — destination sits this vector away from the body. */
  offset: { x: number; y: number; z: number }
  /** Controls target at tween start. */
  fromTgt: { x: number; y: number; z: number }
  /**
   * Live body-position getter — rider-mounted anchors keep moving while
   * the tween runs, so the destination is re-resolved every frame; a
   * static snapshot would land the camera where the body was at arm
   * time. Returns null when the anchor is gone (dest frozen at last).
   */
  track: () => { x: number; y: number; z: number } | null
  /** Last resolved body position — destination anchor when track yields null. */
  last: { x: number; y: number; z: number }
  /** Optional follow-up when the tween completes (fire onSelect). */
  done?: () => void
}
