/**
 * @file engine/bodies/primitives.ts
 * @description Per-body mesh builders for the scene-graph assembler in
 * `../bodies-scene.ts` — textured/fresnel spheres, pick proxies, cloud
 * and ring shells, the additive star halo, and decorative satellite
 * pivots. Split out of bodies-scene.ts so the orchestrator stays a
 * readable dispatch over the body kinds.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL, SF_SCENE } from '@core/tokens/starfield/params.js'
import { SF_KINDS } from '@core/tokens/starfield/kinds.js'
import { haloFor, pointGlowFor, starSurfaceFor, surfaceFor } from './procedural.js'
import { css, rgb, shade, texCanvas, vnoise, weldGeometry } from './procedural/shared.js'
import { lcg, seedFrom } from '../rand.js'
import { matParams } from '../materials.js'
import type { SFBodyDef, SFNode, SFNodeDeps } from '../types.js'

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
 * `userData` key overriding a detail object's LOD reveal distance —
 * updateLod reads it as an absolute camera-to-anchor reach. Local-scale
 * detail (the LEO satellite swarm, ISS-class orbiters) must not inherit
 * the host's heliocentric `orbit` in the generic `PAD + size·SCALE`
 * reach or Earth's near-field shell would render from halfway across
 * the chart; these objects carry their own honest reach instead.
 */
export const SF_USER_DETAIL_R = 'detailReveal'

/**
 * Invisible pick bubble for bodies too small to hit reliably — planets
 * and moons under `SF_DETAIL.PICK_MIN` world units subtend a handful of
 * pixels at the home camera, so a slightly larger transparent sphere
 * (riding inside `mesh` to inherit orbit position and spin) gives the
 * raycaster a usable target. Marked `SF_USER_PROXY` so a real-mesh hit
 * along the same ray always wins; the caller stamps the body id on
 * `userData` since the proxy is shared across kinds.
 * @param THREE The three.js module.
 * @param radius The body's true radius — the proxy scales with it so
 *   honest stellar-scale bodies stay pickable without a fixed giant
 *   bubble swallowing neighbouring stars.
 * @returns The invisible proxy mesh.
 */
export function makePickProxy(THREE: ThreeModule, radius: number): THREE_NS.Object3D {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(radius * SF_DETAIL.PICK_PROXY, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  )

  proxy.userData[SF_USER_PROXY] = true

  return proxy
}

/**
 * Luminous-sphere node material — a star's disc must not read as a flat
 * polygon. The fresnel rim `(1 − |view·n|)^falloff` mixes the body's
 * color/texture toward the limb tint and dips the alpha at the extreme
 * silhouette, so the photosphere dissolves into its additive halo
 * instead of cutting a hard circle against the sky. Built as a
 * MeshBasicNodeMaterial — the WebGPURenderer node pipeline rejects
 * classic GLSL ShaderMaterials.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param colorHex Core tint (def.color; SUN_LIGHT fallback).
 * @param tex Optional photosphere texture — modulates the core.
 * @param rimTint Limb color (hot rim for stars, muted for moons).
 * @param falloff Fresnel exponent — higher keeps a tight bright core.
 */
export function makeGlowSphereMaterial(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  colorHex: number | undefined,
  tex: THREE_NS.Texture | undefined,
  rimTint: number,
  falloff: number
): THREE_NS.Material {
  const { TSL, mats } = deps

  const { mix, normalize, cameraPosition, positionWorld, normalWorld, pow, dot, vec3, texture } =
    TSL

  // Fresnel rim factor — 0 face-on, →1 at the grazing silhouette.
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const fres = pow(dot(viewDir, normalWorld).abs().oneMinus(), falloff)

  const mat = new mats.MeshBasicNodeMaterial()

  // Tints as vec3 constants — color nodes only support scalar mul, but
  // the texture modulate needs componentwise vec3×vec3.
  const coreC = new THREE.Color(colorHex ?? SF_COLORS.SUN_LIGHT)
  const coreTint = vec3(coreC.r, coreC.g, coreC.b)

  const rimC = new THREE.Color(rimTint)
  const rim = vec3(rimC.r, rimC.g, rimC.b)

  // core·tex → limb tint across the fresnel; alpha dips at the extreme
  // silhouette so the sphere edge melts into the halo instead of a
  // raytraced-crisp circle.
  mat.colorNode = tex ? mix(coreTint.mul(texture(tex).rgb), rim, fres) : mix(coreTint, rim, fres)
  mat.transparent = true
  mat.opacityNode = fres.mul(0.55).oneMinus()

  return mat
}

/**
 * Triaxial rubble-pile geometry for `def.irregular` bodies — a detail-7
 * icosahedron crumpled by two octaves of seeded value noise so the
 * silhouette dimples like a captured asteroid instead of reading as a
 * hydrostatic ball. Every vertex sits on the sphere (r = def.radius);
 * the macro displacement `vnoise(unit)·amp` pushes it along its own
 * normal, then a fine octave at `ROCK_FINE_FREQ ×` adds regolith-scale
 * grain so the shading never reads as one smooth lump,
 * then `axes` stretches the solid into the body's true triaxial
 * proportions (Phobos ≈ 27×22×18 km → [1, 0.81, 0.67]). Per-vertex
 * spherical UVs (u = atan2 longitude, v = asin latitude) are baked
 * from the PRE-stretch unit direction so an equirect map still wraps
 * pole-to-pole without smearing across the crumpled facets.
 * @param THREE The three.js module.
 * @param def Catalog entry — `irregular` carries amp + optional axes.
 * @returns Crumpled geometry with spherical UVs + smooth normals.
 */
export function irregularGeometry(THREE: ThreeModule, def: SFBodyDef): THREE_NS.BufferGeometry {
  // Weld BEFORE displacing — `IcosahedronGeometry` is non-indexed, so
  // every face corner is an independent vertex and `computeVertexNormals`
  // would emit PER-FACE normals (the crystalline "wart" facet look).
  // Welded vertices share one normal → smooth continuous shading; the
  // displacement loop then also runs once per unique vertex (~6× fewer
  // noise evaluations at detail 7).
  const geo = weldGeometry(THREE, new THREE.IcosahedronGeometry(def.radius, SF_SCENE.ROCK_DETAIL))

  const rand = lcg(seedFrom(`${def.id}:shape`))

  const ox = rand() * 40
  const oy = rand() * 40
  const oz = rand() * 40

  const amp = def.irregular?.amp ?? 0

  const axes = def.irregular?.axes ?? ([1, 0.88 + rand() * 0.1, 0.82 + rand() * 0.12] as const)

  const pos = geo.attributes.position

  const uv = new Float32Array(pos.count * 2)

  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i)
    const ny = pos.getY(i)
    const nz = pos.getZ(i)

    // Unit direction of the untessellated vertex — all icosahedron
    // vertices lie on the circumsphere, so |p| = def.radius exactly.
    const il = 1 / Math.max(Math.hypot(nx, ny, nz), 1e-6)

    const d =
      1 +
      vnoise(nx + ox, ny + oy, nz + oz) * amp +
      vnoise(
        nx * SF_SCENE.ROCK_MID_FREQ + ox,
        ny * SF_SCENE.ROCK_MID_FREQ + oy,
        nz * SF_SCENE.ROCK_MID_FREQ + oz
      ) *
        amp *
        SF_SCENE.ROCK_MID_AMP +
      vnoise(
        nx * SF_SCENE.ROCK_FINE_FREQ + ox * 2,
        ny * SF_SCENE.ROCK_FINE_FREQ + oy * 2,
        nz * SF_SCENE.ROCK_FINE_FREQ + oz * 2
      ) *
        amp *
        SF_SCENE.ROCK_FINE_AMP

    pos.setXYZ(i, nx * d * axes[0], ny * d * axes[1], nz * d * axes[2])

    // Spherical equirect UV from the unit direction — the photo map
    // keeps landing pole-to-pole no matter how hard the solid crumples.
    uv[i * 2] = Math.atan2(nz, nx) / (Math.PI * 2) + 0.5
    uv[i * 2 + 1] = Math.asin(Math.max(-1, Math.min(1, ny * il))) / Math.PI + 0.5
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))

  geo.computeVertexNormals()

  return geo
}

/**
 * Sphere + material for a solid body — textured when the catalog maps one,
 * tinted procedural otherwise. Stars/systems use the fresnel-limb node
 * material (they emit their own light); planets and smaller get lit
 * MeshStandard. When `sunDir` is passed (day/night registry vector) the
 * body upgrades to `MeshStandardNodeMaterial` so the emissive layer can
 * be gated by the sun direction — city lights never glow on the lit
 * hemisphere.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors.
 * @param def Catalog entry.
 * @param texMap Loaded texture map keyed by URL.
 * @param sunDir Shared sun-direction vector (mutated per frame by
 * `updateDayNight`) — gates the emissive map through `emissiveNode`.
 */
export function makeSphere(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  texMap: Map<string, THREE_NS.Texture>,
  sunDir?: THREE_NS.Vector3
) {
  // Irregular bodies (Phobos, Deimos) swap the perfect sphere for a
  // crumpled triaxial icosahedron — the equirect UVs are baked per
  // vertex so the real photo map still wraps correctly.
  const geo = def.irregular
    ? irregularGeometry(THREE, def)
    : new THREE.SphereGeometry(def.radius, SF_SCENE.SPHERE_SEGMENTS, SF_SCENE.SPHERE_SEGMENTS / 2)

  const luminous = def.kind === SF_KINDS.STAR || def.kind === SF_KINDS.SYSTEM

  if (luminous) {
    return new THREE.Mesh(
      geo,
      makeGlowSphereMaterial(
        THREE,
        deps,
        def.color,
        // No photosphere map → seeded granulation so every star carries
        // a boiling surface under the fresnel limb instead of an
        // eggshell-smooth disc.
        texMap.get(def.texture ?? '') ?? starSurfaceFor(THREE, def),
        // `def.rim` carries limb darkening (dark amber silhouette) on
        // resolved star discs; distant stars keep the hot white rim.
        def.rim ?? SF_COLORS.STAR_RIM,
        SF_DETAIL.STAR_RIM_FALLOFF
      )
    )
  }

  const emiTex = def.emissiveTexture ? texMap.get(def.emissiveTexture) : undefined

  // Node-material path — needed when the emissive map must be gated by
  // the live sun direction (unlit `emissiveMap` would glow on the day
  // side). Falls back to classic MeshStandard when no gating applies.
  const StdCtor =
    sunDir && deps.mats.MeshStandardNodeMaterial
      ? deps.mats.MeshStandardNodeMaterial
      : THREE.MeshStandardMaterial

  const surfTex = texMap.get(def.texture ?? '') ?? surfaceFor(THREE, def)

  const mat = new StdCtor(
    matParams({
      // No photo map → seeded procedural surface (mottle/bands/craters)
      // so untextured moons, dwarf planets and exoplanets read as real
      // worlds instead of flat tinted balls.
      map: surfTex,
      color: def.color,
    })
  )

  // Rubble bodies reuse their albedo map as a bump map — crater rims
  // and regolith grain perturb the shading normal so the high-detail
  // tessellation reads as relief, not a smooth balloon.
  if (def.irregular && surfTex) {
    mat.bumpMap = surfTex
    mat.bumpScale = SF_DETAIL.BUMP_SCALE
  }

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

  if (emiTex) {
    if (sunDir && deps.mats.MeshStandardNodeMaterial) {
      const { dot, normalLocal, smoothstep, texture, uniform, vec3 } = deps.TSL

      const eC = new THREE.Color(SF_COLORS.SUN_LIGHT)

      // Twilight gate — `dot(normalLocal, sunDir)` smoothstepped so city
      // lights bloom only past the terminator and fade in through dusk;
      // the lit hemisphere contributes zero emissive. `sunDir` arrives in
      // the mesh's object space (updateDayNight carries the world vector
      // through R⁻¹), so it pairs with normalLocal, not normalWorld —
      // a world normal would keep the gate glued to one texture face as
      // the planet spins and leak lights onto the lit hemisphere.
      const dayF = smoothstep(
        SF_DETAIL.NIGHT_LO,
        SF_DETAIL.NIGHT_HI,
        dot(normalLocal, uniform(sunDir))
      )

      ;(mat as unknown as { emissiveNode: unknown }).emissiveNode = texture(emiTex)
        .rgb.mul(vec3(eC.r, eC.g, eC.b))
        .mul(SF_DETAIL.EMISSIVE_INT)
        .mul(dayF.oneMinus())
    } else {
      mat.emissiveMap = emiTex
      mat.emissive = new THREE.Color(SF_COLORS.SUN_LIGHT)
      mat.emissiveIntensity = SF_DETAIL.EMISSIVE_INT
    }
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
export function makeCloudShell(
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
 * Atmosphere rim shell — a fresnel-limb translucent sphere just past
 * the surface whose tint migrates with the sun direction: deep blue on
 * the night limb, bright scattering blue on the day limb, and a warm
 * amber band through the terminator (rayleigh→mie analogy). Opacity
 * also dims on the night side so the rim reads thinnest where the air
 * is unlit. `updateDayNight` keeps the shared `sunDir` vector current.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors (bootstrap-injected).
 * @param def Catalog entry — `def.atmosphere` scales the base opacity.
 * @param sunDir Shared sun-direction vector (mutated per frame).
 */
export function makeAtmoShell(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  sunDir: THREE_NS.Vector3
): THREE_NS.Object3D {
  const { TSL } = deps

  const {
    cameraPosition,
    dot,
    mix,
    normalLocal,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    uniform,
    vec3,
  } = TSL

  const geo = new THREE.SphereGeometry(
    def.radius * SF_DETAIL.ATMO_SCALE,
    SF_SCENE.SPHERE_SEGMENTS,
    SF_SCENE.SPHERE_SEGMENTS / 2
  )

  const mat = new deps.mats.MeshBasicNodeMaterial()

  // Fresnel limb factor — 0 face-on, →1 at the grazing silhouette.
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const fres = pow(dot(viewDir, normalWorld).abs().oneMinus(), SF_DETAIL.ATMO_POW)

  // Local normal — the shared sunDir rides the surface mesh's object
  // space; the shell is a direct child so its local frame matches.
  const ndl = dot(normalLocal, uniform(sunDir))

  // Day factor + a dusk band centered just past the terminator.
  const dayF = smoothstep(SF_DETAIL.ATMO_DAY_LO, SF_DETAIL.ATMO_DAY_HI, ndl)
  const duskF = smoothstep(SF_DETAIL.ATMO_DUSK_LO, SF_DETAIL.ATMO_DUSK_MID, ndl).mul(
    smoothstep(SF_DETAIL.ATMO_DUSK_MID, SF_DETAIL.ATMO_DUSK_HI, ndl).oneMinus()
  )

  // Atmosphere tint — `def.atmoColor` pins the whole limb palette for
  // bodies whose sky isn't Earth's nitrogen blue (Titan's opaque tholin
  // haze glows orange day AND dusk); without an override the shell
  // migrates the default day→dusk→night ramp across the terminator.
  const haze = def.atmoColor != null ? new THREE.Color(def.atmoColor) : undefined

  const dayC = haze ?? new THREE.Color(SF_COLORS.ATMO_DAY)
  const duskC = haze ?? new THREE.Color(SF_COLORS.ATMO_DUSK)
  const nightC = new THREE.Color(SF_COLORS.ATMO_NIGHT)

  const tint = mix(
    mix(vec3(nightC.r, nightC.g, nightC.b), vec3(dayC.r, dayC.g, dayC.b), dayF),
    vec3(duskC.r, duskC.g, duskC.b),
    duskF
  )

  mat.colorNode = tint
  mat.transparent = true
  mat.opacityNode = fres
    .mul(SF_DETAIL.ATMO_ALPHA * (def.atmosphere ?? 1))
    .mul(dayF.mul(0.65).add(0.35))
  mat.blending = THREE.AdditiveBlending
  mat.depthWrite = false

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
 * @param flat Point-star mode — a filled core glow (no photosphere behind
 *   it); default annulus leaves a transparent cut for the ball's limb.
 */
export function makeStarHalo(
  THREE: ThreeModule,
  def: SFBodyDef,
  glowTex: THREE_NS.Texture | undefined,
  flat?: boolean
): THREE_NS.Sprite {
  const size = def.radius * SF_DETAIL.HALO_SCALE

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial(
      matParams({
        // Annulus halo — a radial-gradient glow sprite is centered on the
        // ball, so its brightest ring lands on the photosphere and
        // saturates it to white; the annulus keeps the glow outside the
        // limb with the body's tint baked in (SpriteMaterial `color`
        // doesn't multiply the map under the node pipeline). Point stars
        // (sphere-less galactic markers) take the filled core variant —
        // an annulus around nothing would render a hollow ring.
        map: (flat ? pointGlowFor(THREE, def) : haloFor(THREE, def)) ?? glowTex,
        transparent: true,
        opacity: SF_DETAIL.HALO_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  )

  sprite.scale.set(size, size, 1)

  return sprite
}

/**
 * Paints a radius-indexed ring strip for ringed bodies with no photo
 * texture (Uranus, Neptune) — u sweeps inner→outer radius, matching the
 * UV remap makeShell applies to RingGeometry. Seeded thin dusty bands:
 * the real ice-giant ring systems are a handful of razor-thin dark
 * arcs (Uranus: 13 narrow rings, albedo ~0.02; Neptune: 5 faint arcs),
 * so the strip stays mostly transparent with sparse low-alpha bands —
 * never Saturn's broad bright plate.
 * @param THREE The three.js module.
 * @param def Catalog entry — seeds the band layout + tints from color.
 * @returns A CanvasTexture, or undefined without a 2d context.
 */
function ringStripFor(THREE: ThreeModule, def: SFBodyDef): THREE_NS.Texture | undefined {
  const W = SF_DETAIL.RING_STRIP_W
  const H = SF_DETAIL.RING_STRIP_H

  const c = texCanvas(W, H)

  if (!c) return undefined

  const { ctx, canvas } = c
  const rand = lcg(seedFrom(`${def.id}:ring`))
  const base = rgb(def.color ?? SF_COLORS.SUN_LIGHT)

  ctx.clearRect(0, 0, W, H)

  // Narrow dusty arcs — each band is a vertical gradient stroke at a
  // seeded radius, brighter inside its half-width, fading to nothing.
  // `def.ringBands` pins the honest per-system count (Jupiter 4, Uranus
  // 13, Neptune 5) when the catalog supplies it.
  const bands = def.ringBands ?? SF_DETAIL.RING_BANDS

  for (let i = 0; i < bands; i++) {
    const x = (0.2 + rand() * 0.72) * W
    const hw = (0.3 + rand() * 0.7) * SF_DETAIL.RING_BAND_W * W
    const alpha = SF_DETAIL.RING_ALPHA_MIN + rand() * SF_DETAIL.RING_ALPHA_MAX
    const g = ctx.createLinearGradient(x - hw, 0, x + hw, 0)

    g.addColorStop(0, css(base, 0))
    g.addColorStop(0.5, css(shade(base, 0.5 + rand() * 0.3), alpha))
    g.addColorStop(1, css(base, 0))

    ctx.fillStyle = g
    ctx.fillRect(x - hw, 0, hw * 2, H)
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}

/**
 * Translucent shell layer — Venus's haze atmosphere and the giant
 * planets' rings get a secondary texture-mapped surface parented to
 * the main mesh. A ringed body with no authored texture (Uranus,
 * Neptune) falls back to `ringStripFor`'s seeded dusty bands; radii
 * default to Saturn's strip but `def.ringInner`/`ringOuter` pin the
 * honest per-body span. Returns the created Object3D so the caller can
 * register it as LOD detail.
 * @param THREE The three.js module.
 * @param def Catalog entry.
 * @param shellTexture Shell texture URL — undefined for procedural rings.
 * @param parent The primary mesh the shell rides on.
 * @param texMap Loaded texture map keyed by URL.
 */
export function makeShell(
  THREE: ThreeModule,
  def: SFBodyDef,
  shellTexture: string | undefined,
  parent: { add(o: unknown): unknown },
  texMap: Map<string, THREE_NS.Texture>
): THREE_NS.Object3D {
  const tex = shellTexture ? texMap.get(shellTexture) : undefined

  if (def.shellRing) {
    const inner = def.radius * (def.ringInner ?? SF_DETAIL.RING_INNER)

    const outer = def.radius * (def.ringOuter ?? SF_DETAIL.RING_OUTER)

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

    const mat = new THREE.MeshBasicMaterial(
      matParams({
        // No authored strip (Uranus/Neptune) → seeded thin dusty arcs.
        map: tex ?? ringStripFor(THREE, def),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )

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

  const mat = new THREE.MeshBasicMaterial(matParams({ map: tex, transparent: true, opacity: 0.65 }))

  const shell = new THREE.Mesh(geo, mat)

  parent.add(shell)

  return shell
}

/**
 * Crafted-station silhouette — a crewed orbiter (the ISS) is not a ball
 * of light: a long truss carries a pressurized-module core at centre and
 * a pair of wide flat solar-array wings at the tips, all in lit
 * MeshStandardMaterial so the station glints in sunlight and goes dark
 * through eclipse instead of glowing. All proportions derive from
 * `sat.radius` so the model shrinks with the solar tier.
 * @param THREE The three.js module.
 * @param sat Satellite def — `radius` is the core scale unit.
 * @returns The station group (caller positions it on its pivot).
 */
export function makeStation(
  THREE: ThreeModule,
  sat: { radius: number; color?: number }
): THREE_NS.Object3D {
  const r = sat.radius

  const hull = new THREE.MeshStandardMaterial(
    matParams({ color: sat.color ?? SF_COLORS.ISS, metalness: 0.75, roughness: 0.35 })
  )

  const panel = new THREE.MeshStandardMaterial(
    matParams({ color: SF_COLORS.ISS_PANEL, metalness: 0.9, roughness: 0.4 })
  )

  const station = new THREE.Group()

  // Main truss — the ISS's long backbone beam (≈5 core radii across).
  const truss = new THREE.Mesh(new THREE.BoxGeometry(r * 5, r * 0.4, r * 0.4), hull)

  // Pressurized modules — the habitable core at mid-truss.
  const core = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 1.2, r * 1.2), hull)

  // Solar wings — wide flat arrays at both truss tips, panel-gold.
  const wingGeo = new THREE.BoxGeometry(r * 1.4, r * 0.08, r * 3.2)

  const wingA = new THREE.Mesh(wingGeo, panel)

  wingA.position.x = r * 2.3

  const wingB = new THREE.Mesh(wingGeo, panel)

  wingB.position.x = -r * 2.3

  station.add(truss)

  station.add(core)

  station.add(wingA)

  station.add(wingB)

  return station
}

/**
 * Decorative companion satellites — small unlit spheres on child pivots;
 * `sat.station` swaps the glow ball for the crafted truss-and-panels
 * model (ISS). Plain companions carry the same fresnel-limb material as
 * before but now modulated by a surface — the satellite's own photo
 * (`sat.texture`, preloaded with the host's maps) or a seeded
 * `surfaceFor` equirect keyed on `host:sat:index`, so companion worlds
 * are textured bodies too, not bare glow dots. `satPivots` returns the
 * {pivot,speed,phase} records frame.ts rotates.
 * @param THREE The three.js module.
 * @param deps TSL namespace + node-material ctors.
 * @param def Catalog entry — `satellites` lists the companions.
 * @param mesh The host body mesh — pivots attach to it to orbit.
 * @param texMap Loaded texture map keyed by URL.
 */
export function makeSatellites(
  THREE: ThreeModule,
  deps: SFNodeDeps,
  def: SFBodyDef,
  mesh: { add(o: unknown): unknown },
  texMap: Map<string, THREE_NS.Texture>
) {
  const satPivots: SFNode['satPivots'] = []

  for (const [i, sat] of (def.satellites ?? []).entries()) {
    const pivot = new THREE.Object3D()

    // The companion's surface seed — the dossier id when it carries one,
    // else a host-qualified index key so each anonymous world still gets
    // its own deterministic terrain.
    const satKey = sat.id ?? `${def.id}:sat-${i}`

    const sm: THREE_NS.Object3D = sat.station
      ? makeStation(THREE, sat)
      : new THREE.Mesh(
          new THREE.SphereGeometry(
            sat.radius,
            SF_SCENE.SPHERE_SEGMENTS / 2,
            SF_SCENE.SPHERE_SEGMENTS / 4
          ),
          // Companion dots share the fresnel-limb material (dim rim, loose
          // falloff) so they read as small glowing bodies, not hard
          // discs — but the fresnel core modulates with the body's own
          // surface: the authored photo when the satellite declares one,
          // else a seeded procedural equirect so no companion is a
          // featureless marble.
          makeGlowSphereMaterial(
            THREE,
            deps,
            sat.color,
            texMap.get(sat.texture ?? '') ??
              surfaceFor(THREE, {
                id: satKey,
                name: sat.name ?? satKey,
                kind: def.kind,
                group: def.group,
                radius: sat.radius,
                color: sat.color,
                dist: def.dist,
              }),
            sat.color ?? SF_COLORS.SUN_LIGHT,
            SF_DETAIL.SAT_RIM_FALLOFF
          )
        )

    sm.position.x = sat.orbit

    pivot.add(sm)

    pivot.rotation.y = sat.phase ?? 0

    mesh.add(pivot)

    satPivots.push({
      pivot,
      mesh: sm,
      speed: sat.speed,
      phase: sat.phase ?? 0,
      orbit: sat.orbit,
      ecc: sat.ecc,
    })
  }

  return satPivots
}
