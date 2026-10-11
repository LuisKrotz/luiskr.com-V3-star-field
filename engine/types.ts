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

/** The TSL node-graph namespace (compiled to WGSL/GLSL by the renderer). */
type TslNs = typeof import('three/tsl')

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
  mats: { MeshBasicNodeMaterial: typeof MeshBasicNodeMaterial }
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
  structure?: { radius: number; speckles?: number }
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
  scene: THREE_NS.Scene | null
  camera: THREE_NS.PerspectiveCamera | null
  controls: OrbitControls | null
  /** id → runtime body node record. */
  nodes: Map<string, SFNode>
  /** id → center Object3D the camera targets (equals mesh for most). */
  anchors: Map<string, THREE_NS.Object3D>
  /** Pickable meshes for raycasting. */
  pickables: THREE_NS.Object3D[]
  /** ids whose dossier was already prefetched — approach fires once. */
  approached: Set<string>
  /**
   * Real-star cloud Points (HYG catalogue field on the Milky Way disc)
   * — set by star-cloud.ts once the packed binary decodes; kept on
   * state so destroy() can dispose its geometry/material.
   */
  starCloud: THREE_NS.Object3D | null
  /** Guard flag — the star-cloud fetch fires only once per boot. */
  starCloudLoading: boolean
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
  /** Selected body id (panel open). */
  selectedId: string | null
  /** Lifecycle callbacks from the host. */
  onReady?: () => void
  onProgress?: SFProgressFn
  onSelect?: SFBodyFn
  onApproach?: SFBodyFn
  onHover?: (bodyId: string | null) => void
  /**
   * Per-frame hover tracking — fires every tick while a body is hovered
   * with its projected canvas-space pixel position, so the tooltip and
   * its leader line follow orbiting bodies without DOM thrash.
   */
  onHoverMove?: (bodyId: string, x: number, y: number) => void
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
  /** Camera destination. */
  toPos: { x: number; y: number; z: number }
  /** Controls target at tween start. */
  fromTgt: { x: number; y: number; z: number }
  /** Controls target destination (body center). */
  toTgt: { x: number; y: number; z: number }
  /** Optional follow-up when the tween completes (fire onSelect). */
  done?: () => void
}
