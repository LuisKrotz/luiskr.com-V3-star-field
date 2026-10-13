/**
 * @file engine/spiral/galaxy.ts
 * @description Spiral-galaxy assembly — `makeSpiralGalaxy` composes a
 * tilted photographic disc (masked NASA/ESA imagery, `makeGalaxyDisc`),
 * a soft sparkle Points layer of foreground stars, the worker-dispatched
 * procedural fill (with the identical local fallback from `fill.ts`),
 * volumetric dust lanes, a warm core sprite, and an invisible pick
 * sphere so raycasts/hover resolve the galaxy without touching point
 * geometry.
 */
import type * as THREE_NS from 'three'
import { SF_COLORS, SF_DETAIL, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { WASM_ACTIONS, fillField } from '../fill-worker.js'
import { makeGalaxyDisc } from '../bodies/deep-sky.js'
import { seedFrom } from '../rand.js'
import { matParams } from '../materials.js'
import type { SFBodyDef } from '../types.js'
import { fillDust, fillElliptical, fillSpiral } from './fill.js'

type ThreeModule = typeof import('three')

/**
 * One soft-sprite Points cloud — the shared glow texture gives each
 * vertex a round airbrushed edge instead of the default square splat,
 * which is what turned the old cloud into a hard-edged white blob.
 * @param THREE The three.js module.
 * @param pos xyz vertex buffer.
 * @param col rgb vertex buffer.
 * @param sizePx Point size in world units.
 * @param glowTex Shared soft-disc texture (may be undefined).
 */
function makeStarPoints(
  THREE: ThreeModule,
  pos: Float32Array,
  col: Float32Array,
  sizePx: number,
  glowTex: THREE_NS.Texture | undefined,
  volumetric: boolean
): THREE_NS.Points {
  const geo = new THREE.BufferGeometry()

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  // Empty uv — the node pipeline samples `uv` for `map` even though
  // points shade via gl_PointCoord; declaring it keeps the graph quiet.
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2))

  const mat = new THREE.PointsMaterial(
    matParams({
      size: sizePx,
      // Volumetric discs skip the glow map: mapped Points silently fail
      // on some GL stacks (the soft sprite collapses to transparent and
      // the whole galaxy vanishes), and a dense star field wants hard
      // sub-pixel pinpoints anyway — the soft map only pays off on the
      // sparse foreground sparkle layers.
      map: volumetric ? undefined : glowTex,
      vertexColors: true,
      transparent: true,
      opacity: volumetric ? SF_SPIRAL.VOLUMETRIC_OPACITY : 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  )

  const points = new THREE.Points(geo, mat)

  // Volumetric clouds (Milky Way) need per-frame distance fade so they
  // do not read as an opaque glowing ball while the camera is inside.
  points.userData = { volumetric: volumetric }

  // Keep raycasts off the point cloud — the pick sphere handles hover.
  points.raycast = () => undefined

  return points
}

/**
 * Builds a spiral galaxy node: tilted group containing the photographic
 * disc (or the seeded procedural spiral when no photo resolved), a soft
 * sparkle layer of foreground stars for depth, a warm additive core
 * sprite for the bulge glow, and an invisible sphere carrying
 * `userData.bodyId` so picking/hover work against a real mesh.
 * @param THREE The three.js module.
 * @param def Catalog galaxy entry (radius = disc radius, tilt = disc
 * tilt, `spiralDisc.count` = particle target standing in for the true
 * stellar population — capped by `COUNT_MAX` and quartered on mobile).
 * @param texMap Loaded texture map keyed by URL — the body's `texture`
 * resolves through it; a missing/absent entry keeps the procedural path.
 * @param glowTex Shared radial-gradient glow texture (may be undefined).
 * @param mobile Whether to apply the mobile divisor (small viewport).
 * @returns `{ group, pick, points, rotor }` — the tilted spin target, the
 * pickable mesh, the static outer sparkle/cloud Points, and (volumetric
 * spinning galaxies only) the inner-disc rotor group whose rotation.y
 * revolves the core around the galactic center without sweeping the
 * carved heliocentric bubble through the solar system.
 */
export function makeSpiralGalaxy(
  THREE: ThreeModule,
  def: SFBodyDef,
  texMap: Map<string, THREE_NS.Texture> | undefined,
  glowTex: THREE_NS.Texture | undefined,
  mobile = false
): {
  group: THREE_NS.Object3D
  pick: THREE_NS.Object3D
  points: THREE_NS.Points
  rotor?: THREE_NS.Object3D
} {
  const group = new THREE.Group()

  const asked = Math.min(def.spiralDisc?.count ?? SF_SPIRAL.COUNT, SF_SPIRAL.COUNT_MAX)

  const count = mobile ? Math.max(1, Math.floor(asked / SF_SPIRAL.MOBILE_DIVISOR)) : asked

  const arms = def.spiralDisc?.arms ?? SF_SPIRAL.ARMS

  // Volumetric galaxies (the Milky Way — viewed from inside) never load
  // a photo quad: a face-on billboard is geometrically false for an
  // embedded observer, so the particle disc IS the body.
  const volumetric = Boolean(def.spiralDisc?.volumetric)

  const photoTex = volumetric ? undefined : def.texture ? texMap?.get?.(def.texture) : undefined

  if (photoTex) {
    // Photographic path — masked disc carries the true imagery; the
    // group owns the tilt, so the disc lays flat locally (0).
    group.add(makeGalaxyDisc(THREE, def, texMap as Map<string, THREE_NS.Texture>, glowTex, 0))
  }

  // Sparkle layer — over the photo it is a sparse foreground-star cloud
  // (resolved star-forming knots riding the imagery); in the fallback it
  // IS the galaxy body, so it takes the full particle budget. Always
  // seeded, so the speckle pattern is stable across visits.
  // Volumetric galaxies (the Milky Way) are embedded in — the catalog's
  // own particle target applies (capped, mobile-divided) so the disc is
  // dense enough for its arms to resolve when the camera pulls back,
  // while the per-frame distance fade keeps the embedded view a band.
  const askedVolumetric = Math.min(
    def.spiralDisc?.count ?? SF_SPIRAL.VOLUMETRIC_COUNT,
    SF_SPIRAL.VOLUMETRIC_COUNT_MAX
  )

  const effectiveCount = volumetric
    ? mobile
      ? Math.max(1, Math.floor(askedVolumetric / SF_SPIRAL.MOBILE_DIVISOR))
      : askedVolumetric
    : count

  const sparkleCount = photoTex
    ? Math.max(64, Math.floor(effectiveCount * SF_DETAIL.SPARKLE_FRAC))
    : effectiveCount

  const pos = new Float32Array(sparkleCount * 3)

  const col = new Float32Array(sparkleCount * 3)

  const seed = seedFrom(def.id)

  /**
   * Rotor split — a volumetric galaxy with `spin` partitions its
   * particle fill at SF_SPIRAL.INNER_SPIN_R: points inside the cutoff
   * ride a rotor subgroup that tickFrame spins ROTOR_DIFF× faster than
   * the whole-disc spin, so the core laps the rim the way real flat
   * rotation curves do. The rotor/inner geometries mount eagerly
   * (empty) and receive their attributes when the fill resolves — the
   * carve-out bubble co-rotates rigidly with the rider-mounted Sun so
   * rigid whole-disc spin never sweeps it through the solar system.
   */
  const spinCut2 = volumetric && def.spin ? (def.radius * SF_SPIRAL.INNER_SPIN_R) ** 2 : 0

  let rotor: THREE_NS.Object3D | undefined
  let innerGeo: THREE_NS.BufferGeometry | undefined

  const points = makeStarPoints(
    THREE,
    pos,
    col,
    photoTex ? SF_DETAIL.SPARKLE_PX : SF_SPIRAL.POINT_PX,
    glowTex,
    volumetric
  )

  if (spinCut2 > 0) {
    innerGeo = new THREE.BufferGeometry()

    // Shared material — one draw state, and updateGalaxyClouds' distance
    // fade applies to both layers through the same opacity write.
    const innerPts = new THREE.Points(innerGeo, points.material)

    innerPts.userData = { volumetric: true }
    innerPts.raycast = () => undefined

    rotor = new THREE.Group()
    rotor.add(innerPts)
    group.add(rotor)
  }

  group.add(points)

  /**
   * Writes a resolved fill into the geometries — with a rotor the
   * buffers partition at spinCut2 (inner cloud ↔ outer disc, order
   * preserved); without it the cloud takes the buffers whole.
   * @param p Filled xyz buffer.
   * @param c Filled rgb buffer.
   * @param geo Target geometry (star cloud or dust lanes).
   * @param into Inner geometry when a rotor split applies.
   */
  const applyFill = (
    p: Float32Array,
    c: Float32Array,
    geo: THREE_NS.BufferGeometry,
    into?: THREE_NS.BufferGeometry
  ): void => {
    const n = p.length / 3

    if (into) {
      let nIn = 0

      for (let i = 0; i < n; i++) {
        if (p[i * 3] * p[i * 3] + p[i * 3 + 2] * p[i * 3 + 2] < spinCut2) nIn++
      }

      const ip = new Float32Array(nIn * 3)
      const ic = new Float32Array(nIn * 3)
      const op = new Float32Array((n - nIn) * 3)
      const oc = new Float32Array((n - nIn) * 3)

      let ii = 0
      let oo = 0

      for (let i = 0; i < n; i++) {
        const inner = p[i * 3] * p[i * 3] + p[i * 3 + 2] * p[i * 3 + 2] < spinCut2
        const dst = inner ? ip : op
        const dstC = inner ? ic : oc
        const j = inner ? ii++ : oo++

        dst[j * 3] = p[i * 3]
        dst[j * 3 + 1] = p[i * 3 + 1]
        dst[j * 3 + 2] = p[i * 3 + 2]
        dstC[j * 3] = c[i * 3]
        dstC[j * 3 + 1] = c[i * 3 + 1]
        dstC[j * 3 + 2] = c[i * 3 + 2]
      }

      into.setAttribute('position', new THREE.BufferAttribute(ip, 3))
      into.setAttribute('color', new THREE.BufferAttribute(ic, 3))
      into.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nIn * 2), 2))

      p = op
      c = oc
    }

    geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((p.length / 3) * 2), 2))
  }

  // The heliocentric bubble lives in the group's LOCAL frame — the Sun
  // sits at the world origin, so its local coords are the inverse
  // rotation.x of `−def.pos` (for the MW: def.pos=(−267,0,0) → local
  // (267,0,0), the Sun's true galactocentric ring).
  let bubble: { x: number; y: number; z: number; r: number } | undefined

  if (def.spiralDisc?.bubble && def.pos) {
    const a = -Math.PI / 2 + (def.tilt ?? 0)

    const wy = -def.pos[1]

    const wz = -def.pos[2]

    bubble = {
      x: -def.pos[0],
      y: wy * Math.cos(-a) - wz * Math.sin(-a),
      z: wy * Math.sin(-a) + wz * Math.cos(-a),
      r: def.spiralDisc.bubble,
    }
  }

  const geo = points.geometry as THREE_NS.BufferGeometry

  if (def.spiralDisc?.elliptical) {
    // Dwarf spheroidal/irregular — smooth unresolved smudge tinted by
    // the catalog color (warm old population vs cool irregular haze).
    const c = new THREE.Color(def.color ?? SF_COLORS.DWARF_SPH)

    const tint: [number, number, number] = [c.r, c.g, c.b]

    fillField(
      WASM_ACTIONS.SF_FILL_ELLIPTICAL,
      { seed, count: sparkleCount, radius: def.radius, tint, p: SF_SPIRAL },
      sparkleCount,
      true
    ).then((res) => {
      if (res) {
        applyFill(res.pos, res.col, geo, innerGeo)
      } else {
        fillElliptical(pos, col, def.radius, seed, sparkleCount, tint)
        applyFill(pos, col, geo, innerGeo)
      }
    })
  } else {
    const thick = volumetric ? SF_SPIRAL.VOLUMETRIC_THICK : def.spiralDisc?.thick
    const halo = volumetric ? SF_SPIRAL.VOLUMETRIC_HALO : def.spiralDisc?.halo
    const jitter = volumetric ? SF_SPIRAL.VOLUMETRIC_ARM_JITTER : def.spiralDisc?.jitter

    fillField(
      WASM_ACTIONS.SF_FILL_SPIRAL,
      {
        seed,
        count: sparkleCount,
        radius: def.radius,
        arms,
        thick,
        halo,
        jitter,
        bubble,
        p: SF_SPIRAL,
      },
      sparkleCount,
      true
    ).then((res) => {
      if (res) {
        applyFill(res.pos, res.col, geo, innerGeo)
      } else {
        fillSpiral(pos, col, def.radius, seed, sparkleCount, arms, thick, halo, jitter, bubble)
        applyFill(pos, col, geo, innerGeo)
      }
    })
  }

  // Dust lanes — volumetric galaxies only. Soft dark occluders ride the
  // gaps between spiral arms with NORMAL blending so they absorb the
  // lit disc behind them; this is the Great Rift down the Milky Way's
  // band, the feature that makes an embedded galaxy read as dusty.
  if (volumetric) {
    const dmat = new THREE.PointsMaterial(
      matParams({
        size: SF_SPIRAL.DUST_PX,
        map: glowTex,
        vertexColors: true,
        transparent: true,
        opacity: SF_SPIRAL.DUST_OPACITY,
        depthWrite: false,
        sizeAttenuation: true,
      })
    )

    const dgeo = new THREE.BufferGeometry()

    const dust = new THREE.Points(dgeo, dmat)

    dust.raycast = () => undefined
    group.add(dust)

    // Inner lanes ride the rotor — dust is part of the disc, not a
    // fixed overlay, so it shares the differential rotation split.
    let dustInGeo: THREE_NS.BufferGeometry | undefined

    if (rotor && spinCut2 > 0) {
      dustInGeo = new THREE.BufferGeometry()

      const dustIn = new THREE.Points(dustInGeo, dmat)

      dustIn.raycast = () => undefined
      rotor.add(dustIn)
    }

    const dpos = new Float32Array(SF_SPIRAL.DUST_COUNT * 3)
    const dcol = new Float32Array(SF_SPIRAL.DUST_COUNT * 3)

    fillField(
      WASM_ACTIONS.SF_FILL_DUST,
      { seed, count: SF_SPIRAL.DUST_COUNT, radius: def.radius, arms, p: SF_SPIRAL },
      SF_SPIRAL.DUST_COUNT,
      true
    ).then((res) => {
      if (res) {
        applyFill(res.pos, res.col, dgeo, dustInGeo)
      } else {
        fillDust(dpos, dcol, seed, SF_SPIRAL.DUST_COUNT, def.radius, arms)
        applyFill(dpos, dcol, dgeo, dustInGeo)
      }
    })
  }

  // Core bloom sprite — for external galaxies it marks the bulge; for
  // embedded volumetric galaxies (the Milky Way) it would sit in the
  // viewer's lap and wash the whole frame, so shrink it to a whisper.
  const coreMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: def.color ?? SF_COLORS.MILKY_WAY,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: volumetric ? 0.12 : photoTex ? SF_SPIRAL.CORE_PHOTO : SF_SPIRAL.CORE_GLOW,
  })

  const core = new THREE.Sprite(coreMat)

  const coreSize = volumetric ? def.radius * 0.08 : def.radius * 0.45

  core.scale.set(coreSize, coreSize, 1)

  group.add(core)

  // Dwarf-galaxy backing halo — elliptical fills are size-attenuated
  // Points that collapse to sub-pixel dust at Local-Group standoff
  // distances, so a soft tinted sprite spanning the whole smudge keeps
  // the body readable as a fuzzy unresolved patch (the way a dwarf
  // spheroidal looks in a real long-exposure frame) instead of
  // vanishing entirely when the camera backs off.
  if (!photoTex && def.spiralDisc?.elliptical) {
    const haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: def.color ?? SF_COLORS.DWARF_SPH,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: SF_SPIRAL.DWARF_HALO_OPACITY,
    })

    const halo = new THREE.Sprite(haloMat)

    const haloSize = def.radius * SF_SPIRAL.DWARF_HALO_SCALE

    halo.scale.set(haloSize, haloSize, 1)

    group.add(halo)
  }

  const pick = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.5, 16, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  )

  group.add(pick)

  group.rotation.x = -Math.PI / 2 + (def.tilt ?? 0)

  return { group, pick, points, rotor }
}
