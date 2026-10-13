/**
 * @file engine/bodies/belt-rocks.ts
 * @description Hero asteroids for the two belts — COUNT individual
 * displaced-polyhedron meshes riding Keplerian pivots inside each
 * belt's annulus, textured per material class so the belt reads as a
 * real mix of bodies instead of bare points:
 *
 *   - `stone`  — silicate speckle + crater field, rough, flat-shaded.
 *   - `carbon` — near-black carbonaceous mottle (the dominant C-types).
 *   - `hydro`  — hydrated clay minerals (CM chondrites) — rust-dark mud.
 *   - `metal`  — iron-nickel glints over dark ground, low roughness.
 *   - `ice`    — pale cometary surface with bright fracture streaks.
 *   - `dust`   — soft regolith mottle, no features.
 *
 * Silhouettes come in two families: rounded irregular bodies (detail-1
 * icosahedra crumpled by seeded value noise) and collision FRAGMENTS
 * (tetrahedra sheared harder — the shard look is deliberate for
 * fragments only). Per-vertex spherical UVs (u = longitude, v =
 * latitude) wrap each rock in its class canvas texture, and every rock
 * gets its own geometry seed so no two silhouettes match.
 *
 * Rocks ride `satPivots` entries — fx.ts sweeps the pivot (orbit) and
 * tumbles the child mesh. The group joins `pickables` so a direct
 * click on a hero rock resolves to the belt body (the parent chain
 * carries `SF_USER_BODY`), while the invisible annulus proxy catches
 * clicks on the particle band itself.
 */
import type * as THREE_NS from 'three'
import { SF_BELT_ROCK, SF_COLORS } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../rand.js'
import { matParams } from '../materials.js'
import { blob, css, rgb, shade, texCanvas, vnoise } from './procedural/shared.js'
import type { SFBodyDef, SFNode } from '../types.js'

type ThreeModule = typeof import('three')

/** Rock texture canvas size — small equirect, speckle hides seams. */
const _TEX_W = 128
const _TEX_H = 64

/**
 * Material class descriptor — palette source + paint recipe + PBR
 * tuning for one family of belt rock.
 */
interface RockClass {
  /** Seed/texture key. */
  key: string
  /** Packed hex base color the texture derives its shades from. */
  color: number
  /** Pick probability (the five must sum to 1). */
  p: number
  /** Material roughness — metal reads glossier than regolith. */
  roughness: number
  /** Material metalness — only the `metal` class is truly metallic. */
  metalness: number
  /** Flat shading — stone/carbon keep facets, ice/dust stay smooth. */
  flat: boolean
}

/**
 * The five belt material classes, mirroring real asteroid taxonomy —
 * stony chondrites dominate, carbonaceous next, dust/ice/metal trail.
 */
const _CLASSES: readonly RockClass[] = [
  {
    key: 'stone',
    color: SF_COLORS.ROCK_STONE,
    p: SF_BELT_ROCK.CLASS_STONE,
    roughness: 0.95,
    metalness: 0.05,
    flat: true,
  },
  {
    key: 'carbon',
    color: SF_COLORS.ROCK_CARBON,
    p: SF_BELT_ROCK.CLASS_CARBON,
    roughness: 1.0,
    metalness: 0.0,
    flat: true,
  },
  {
    key: 'hydro',
    color: SF_COLORS.ROCK_HYDRO,
    p: SF_BELT_ROCK.CLASS_HYDRO,
    roughness: 0.9,
    metalness: 0.0,
    flat: true,
  },
  {
    key: 'dust',
    color: SF_COLORS.ROCK_DUST,
    p: SF_BELT_ROCK.CLASS_DUST,
    roughness: 1.0,
    metalness: 0.0,
    flat: false,
  },
  {
    key: 'ice',
    color: SF_COLORS.ROCK_ICE,
    p: SF_BELT_ROCK.CLASS_ICE,
    roughness: 0.5,
    metalness: 0.0,
    flat: false,
  },
  {
    key: 'metal',
    color: SF_COLORS.ROCK_METAL,
    p: 0,
    roughness: 0.35,
    metalness: 0.85,
    flat: false,
  },
]

/**
 * Paints one material-class texture: base fill + per-class features —
 * crater pits for stone, specular veins for metal, fracture streaks
 * for ice, nothing but grain for carbon/dust.
 * @param THREE The three.js module.
 * @param cls Material class descriptor.
 * @param rand Seeded RNG.
 * @returns CanvasTexture or undefined when 2d is unavailable.
 */
function rockTexture(
  THREE: ThreeModule,
  cls: RockClass,
  rand: () => number
): THREE_NS.Texture | undefined {
  const c = texCanvas(_TEX_W, _TEX_H)

  if (!c) return undefined

  const { ctx, canvas } = c
  const base = rgb(cls.color)

  ctx.fillStyle = css(base, 1)
  ctx.fillRect(0, 0, _TEX_W, _TEX_H)

  // Grain field — every class gets speckle so the surface never reads
  // as a smooth tint at texture zoom.
  for (let i = 0; i < 90; i++) {
    const k = (rand() - 0.5) * 0.5

    blob(
      ctx,
      _TEX_W,
      _TEX_H,
      rand() * _TEX_W,
      rand() * _TEX_H,
      0.5 + rand() * 2.4,
      css(shade(base, k), 0.55),
      css(base, 0)
    )
  }

  if (cls.key === 'stone' || cls.key === 'carbon' || cls.key === 'hydro') {
    // Impact pits — shadowed bowl + lit rim, matching the moon recipe.
    for (let i = 0; i < 12; i++) {
      const x = rand() * _TEX_W
      const y = rand() * _TEX_H
      const r = 1.5 + rand() * 5

      blob(ctx, _TEX_W, _TEX_H, x, y, r, css(shade(base, -0.35), 0.6), css(base, 0))
      blob(
        ctx,
        _TEX_W,
        _TEX_H,
        x - r * 0.25,
        y - r * 0.25,
        r * 0.6,
        css(shade(base, 0.3), 0.4),
        css(base, 0)
      )
    }
  } else if (cls.key === 'metal') {
    // Specular veins — thin bright strokes like polished iron faces.
    for (let i = 0; i < 7; i++) {
      const x = rand() * _TEX_W
      const y = rand() * _TEX_H
      const len = _TEX_W * (0.1 + rand() * 0.35)
      const ang = rand() * Math.PI

      ctx.strokeStyle = css(shade(base, 0.55), 0.5)
      ctx.lineWidth = 0.6 + rand() * 1.2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
      ctx.stroke()
    }
  } else if (cls.key === 'ice') {
    // Fracture streaks — pale cracks over dirty-ice ground.
    for (let i = 0; i < 5; i++) {
      const x0 = rand() * _TEX_W
      const y0 = rand() * _TEX_H
      const len = _TEX_W * (0.3 + rand() * 0.5)
      const ang = rand() * Math.PI
      const g = ctx.createLinearGradient(x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len)

      g.addColorStop(0, css(base, 0))
      g.addColorStop(0.5, css(shade(base, 0.4), 0.55))
      g.addColorStop(1, css(base, 0))

      ctx.strokeStyle = g
      ctx.lineWidth = 0.8 + rand() * 2
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len)
      ctx.stroke()
    }
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = THREE.SRGBColorSpace

  return out
}

/**
 * Builds one unique rock geometry — either a crumpled icosahedron
 * (irregular body) or a sheared tetrahedron (collision fragment).
 * Vertices are displaced radially by seeded value noise, then per-
 * vertex spherical UVs (u = atan2 longitude, v = asin latitude) are
 * baked so the class texture wraps the body like a moon map.
 * @param THREE The three.js module.
 * @param frag True → tetrahedral fragment shape.
 * @param rand Seeded RNG for this individual rock.
 */
function rockGeometry(
  THREE: ThreeModule,
  frag: boolean,
  rand: () => number
): THREE_NS.BufferGeometry {
  const geo = frag
    ? new THREE.TetrahedronGeometry(1, SF_BELT_ROCK.FRAG_DETAIL)
    : new THREE.IcosahedronGeometry(1, SF_BELT_ROCK.DETAIL)

  const pos = geo.attributes.position

  const jitter = frag ? SF_BELT_ROCK.JITTER_FRAG : SF_BELT_ROCK.JITTER

  const ox = rand() * 40
  const oy = rand() * 40
  const oz = rand() * 40

  const uv = new Float32Array(pos.count * 2)

  for (let i = 0; i < pos.count; i++) {
    // Radial displacement in unit space — noise × jitter crumples the
    // silhouette; fragments get hit harder so they read as shards.
    const nx = pos.getX(i)
    const ny = pos.getY(i)
    const nz = pos.getZ(i)

    const d = 1 + vnoise(nx + ox, ny + oy, nz + oz) * jitter * 0.5

    pos.setXYZ(i, nx * d, ny * d, nz * d)

    const il = 1 / Math.max(Math.hypot(nx, ny, nz), 1e-6)

    uv[i * 2] = Math.atan2(nz, nx) / (Math.PI * 2) + 0.5
    uv[i * 2 + 1] = Math.asin(Math.max(-1, Math.min(1, ny * il))) / Math.PI + 0.5
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))

  geo.computeVertexNormals()

  return geo
}

/**
 * Picks a material class for one rock from the cumulative probability
 * table (metal holds the implicit remainder of the four named classes).
 * @param rand Seeded RNG.
 */
function pickClass(rand: () => number): RockClass {
  let roll = rand()

  for (const cls of _CLASSES) {
    roll -= cls.p

    if (roll <= 0) return cls
  }

  return _CLASSES[_CLASSES.length - 1]
}

/**
 * Populates an asteroid-belt definition with hero rock meshes — the
 * particle annulus stays as the mass background, these give the belt
 * its readable "rocks drifting past" foreground on fly-in.
 * @param THREE The three.js module.
 * @param def The belt's catalog entry — `def.belt` sizes the annulus.
 * @returns `group` of rock pivots + `pivots` satPivots entries.
 */
export function makeBeltRocks(
  THREE: ThreeModule,
  def: SFBodyDef
): { group: THREE_NS.Object3D; pivots: NonNullable<SFNode['satPivots']> } {
  const R = SF_BELT_ROCK
  const belt = def.belt

  const inner = belt?.inner ?? 0
  const width = Math.max((belt?.outer ?? 0) - inner, 1)
  const puff = (belt?.puff ?? 0.16) * width

  const rand = lcg(seedFrom(`${def.id}:rocks`))

  const group = new THREE.Group()

  const pivots: NonNullable<SFNode['satPivots']> = []

  // One material per class (shared across every rock of that class);
  // geometry stays per-rock so silhouettes never repeat.
  const mats = new Map<string, THREE_NS.Material>()

  const matFor = (cls: RockClass): THREE_NS.Material => {
    const cached = mats.get(cls.key)

    if (cached) return cached

    const mat = new THREE.MeshStandardMaterial(
      matParams({
        map: rockTexture(THREE, cls, lcg(seedFrom(`${def.id}:${cls.key}:tex`))),
        color: cls.color,
        roughness: cls.roughness,
        metalness: cls.metalness,
        flatShading: cls.flat,
      })
    )

    mats.set(cls.key, mat)

    return mat
  }

  for (let i = 0; i < R.COUNT; i++) {
    const cls = pickClass(rand)
    const frag = rand() < R.FRAGMENT_FRAC
    const big = rand() < R.BIG_FRAC

    // Size — fragments cluster small, regulars mid-band, a few promoted
    // to planetesimal range (still far under dwarf-planet scale).
    const lo = frag ? R.SIZE_MIN : R.SIZE_MIN * 1.6
    const hi = big ? R.BIG_MAX : R.SIZE_MAX
    const scale = (lo + (hi - lo) * rand() * rand()) * width

    const geo = rockGeometry(THREE, frag, rand)

    const mesh = new THREE.Mesh(geo, matFor(cls))

    mesh.scale.setScalar(scale)

    // Kepler pivot — orbit speed falls off as 1/√r so inner rocks lap
    // outer ones, the honest belt read.
    const pivot = new THREE.Object3D()

    const rad = inner + rand() * width

    mesh.position.set(rad, (rand() - 0.5) * puff, 0)

    pivot.add(mesh)
    group.add(pivot)

    pivots.push({
      pivot,
      mesh,
      speed: R.ORBIT_SPEED / Math.sqrt(rad / Math.max(inner, 1)),
      phase: rand() * Math.PI * 2,
      orbit: rad,
      spin: R.SPIN_MIN + rand() * R.SPIN_SPAN * (frag ? 1.8 : 1),
    })
  }

  return { group, pivots }
}
