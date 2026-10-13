/**
 * @file engine/catalog/solar.ts
 * @description Solar-system tier — the Sun, planets, moons, dwarf
 * planets and asteroid/Kuiper belts at authored diagram scale, then
 * shrunk to render scale via `shrinkSolar`. Split out of catalog.ts.
 */

import { SF_COLORS } from '@core/tokens/starfield/params.js'
import { SF_TEXTURES } from '@core/tokens/starfield/textures.js'
import { SF_GROUPS, SF_KINDS, SF_SURFACES } from '@core/tokens/starfield/kinds.js'
import type { SFBodyDef } from '../types.js'
import { shrinkSolar } from './geo.js'

/**
 * Solar-system bodies — compressed orbits so all eight planets fit inside
 * a single readable sweep around the Sun, then shrunken by
 * SF_SCALE.SOLAR_SCALE (see `shrinkSolar` above). The literal is typed
 * before mapping so `pos` keeps its tuple shape through the transform.
 *
 * Spacing is eccentricity-aware: every adjacent pair keeps a clear limb
 * gap even at worst-case conjunction (inner body's aphelion vs outer
 * body's perihelion), so Mars can never crowd Earth's orbit the way a
 * tighter compression allowed. Saturn clears Jupiter by its full ring
 * extent (radius × RING_OUTER), and the asteroid belt sits between
 * Mars's aphelion and Jupiter's perihelion like the real 2.06–3.27 AU
 * band. Ryugu and Bennu intentionally cross Earth/Mars orbits — they are
 * real near-Earth asteroids and read as flyby specks.
 */
const SOLAR_RAW: SFBodyDef[] = [
  {
    id: 'sun',
    name: 'Sun',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.SOLAR,
    radius: 12,
    pos: [0, 0, 0],
    dist: '0 AU',
    texture: SF_TEXTURES.SUN,
    color: SF_COLORS.EMISSIVE_SUN,
    rim: SF_COLORS.STAR_LIMB,
    activity: 1.7,
    spin: 0.05,
    // Limb prominences — flare sprites rooted at the photosphere edge
    // breathe and stretch outward with the solar-wind cycle.
    flares: true,
  },
  {
    id: 'mercury',
    name: 'Mercury',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 0.8,
    orbit: 24,
    // Period ratios are sqrt-compressed (see earth's entry) — Mercury
    // laps the sun ~2× Earth's visual rate vs the real 4.15×.
    speed: 2.04,
    spin: 0.02,
    // 0.03° — Mercury's axis is the system's most upright.
    tilt: 0.0006,
    // 0.206 — the most eccentric planet; perihelion 0.31 AU,
    // aphelion 0.47 AU.
    ecc: 0.206,
    dist: '0.39 AU',
    texture: SF_TEXTURES.MERCURY,
    meteors: true,
    phase: 0.4,
  },
  {
    id: 'venus',
    name: 'Venus',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 1.6,
    orbit: 36,
    speed: 1.27,
    // Retrograde and slow — the real Venus is the chart's only planet
    // whose sidereal day (243 d, backwards) outlasts its year (225 d).
    // spin −0.25·SPIN_SPEED = −0.03 rad/s vs orbit 1.2·ORBIT_SPEED =
    // 0.06 rad/s → a Venus "day" (~210 s) takes ~2× its "year" (~105 s),
    // and the negative sign keeps it turning against every sibling.
    spin: -0.25,
    // Venus's formal obliquity is 177.4° — equivalently a 2.6° tilt
    // with a retrograde day, which is what the negative spin already
    // renders, so only the 2.6° residual is authored here.
    tilt: 0.046,
    ecc: 0.007,
    dist: '0.72 AU',
    texture: SF_TEXTURES.VENUS_SURFACE,
    shellTexture: SF_TEXTURES.VENUS_ATMOS,
    phase: 1.8,
  },
  {
    id: 'earth',
    name: 'Earth',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 1.7,
    orbit: 44,
    // Orbital speeds follow the real sidereal-period ranking —
    // speed ∝ (365.25 d / P)^0.5 so Mercury sprints, the giants drift,
    // and the ordering/pacing stays honest without Neptune freezing
    // (real ratio Earth:Neptune is 165:1, illegible at chart scale).
    speed: 1.0,
    spin: 1.0,
    tilt: 0.41,
    ecc: 0.017,
    dist: '1 AU',
    texture: SF_TEXTURES.EARTH_DAY,
    normalTexture: SF_TEXTURES.EARTH_NORMAL,
    emissiveTexture: SF_TEXTURES.EARTH_NIGHT,
    cloudTexture: SF_TEXTURES.EARTH_CLOUDS,
    bumpTexture: SF_TEXTURES.EARTH_ELEVATION,
    atmosphere: 1,
    // Living weather — procedural jet streams, ITCZ/monsoon band,
    // hurricanes, seasonal snow lines, volcanic ash + cloud shadows
    // (engine/bodies/weather.ts), fed by the shared fxTime uniform.
    weather: true,
    // Boreal curtains — solar-wind-driven emission oval, magnetic-north
    // only in this scene (south: false drops the australis counterpart).
    aurora: { south: false },
    // Starlink-class LEO swarm — a point shell sweeping one inclined
    // plane. The id makes the whole annulus a pickable dossier body:
    // clicking the glint ring opens the near-Earth-satellite story.
    constellation: {
      count: 56,
      orbit: 1.45,
      id: 'near-earth-satellites',
      name: 'Near-Earth Satellites',
    },
    phase: 3.1,
    cycle: { period: 90 },
    // ISS — the largest crewed object in low Earth orbit: rendered as a
    // lit truss-and-panels model (`station`), hugging the cloud deck in
    // a true close orbit and lapping the planet fast enough to read as
    // artificial against the Moon's stately sweep.
    satellites: [
      {
        // A real pickable dossier body — clicking the station opens its
        // fact sheet like any catalog world.
        id: 'iss',
        name: 'ISS',
        radius: 0.09,
        orbit: 2.05,
        speed: 9,
        color: SF_COLORS.ISS,
        phase: 0.7,
        station: true,
      },
    ],
  },
  {
    id: 'moon',
    name: 'Moon',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.45,
    orbit: 4.5,
    parent: 'earth',
    speed: 3.4,
    // 0.055 — enough eccentricity to swing perigee/apogee ~12%.
    ecc: 0.055,
    dist: '384 400 km',
    texture: SF_TEXTURES.MOON,
    meteors: true,
    phase: 1.2,
  },
  {
    id: 'mars',
    name: 'Mars',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 1.1,
    orbit: 56,
    speed: 0.73,
    spin: 0.97,
    // 25.2° — Mars seasons mirror Earth's, amplified by the orbit.
    tilt: 0.44,
    ecc: 0.093,
    dist: '1.52 AU',
    texture: SF_TEXTURES.MARS,
    phase: 4.4,
  },
  {
    id: 'ceres',
    name: 'Ceres',
    kind: SF_KINDS.DWARF,
    group: SF_GROUPS.SOLAR,
    radius: 0.35,
    orbit: 70,
    speed: 0.47,
    tilt: 0.07,
    ecc: 0.079,
    dist: '2.77 AU',
    // Dawn HAMO global mosaic (PIA20351) — real bright spots at Occator.
    texture: SF_TEXTURES.CERES,
    meteors: true,
    phase: 0.9,
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 4.4,
    orbit: 90,
    speed: 0.29,
    spin: 2.4,
    // 3.1° — Jupiter's axis is nearly upright, which is why its belts
    // stay symmetric about the equator year-round.
    tilt: 0.054,
    ecc: 0.048,
    dist: '5.20 AU',
    texture: SF_TEXTURES.JUPITER,
    // Jupiter's ring system — four tenuous dusty components (halo, main
    // ring, Amalthea + Thebe gossamer) spanning ~1.4–2.5 R, far fainter
    // than Saturn's plate. Seeded procedural strip supplies the bands.
    shellRing: true,
    ringInner: 1.4,
    ringOuter: 2.5,
    ringBands: 4,
    // Jovian auroras — the system's most powerful: tight, bright
    // cyan-violet hydrogen curtains (Jupiter's field emits mostly UV).
    aurora: {
      color: SF_COLORS.AURORA_JUPITER,
      colorLow: SF_COLORS.AURORA_JUPITER_LOW,
      tilt: 0.17,
      lat: 0.85,
      intensity: 1.2,
    },
    phase: 5.3,
  },
  {
    id: 'saturn',
    name: 'Saturn',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 3.8,
    orbit: 118,
    speed: 0.18,
    spin: 2.2,
    tilt: 0.47,
    ecc: 0.056,
    dist: '9.58 AU',
    texture: SF_TEXTURES.SATURN,
    shellTexture: SF_TEXTURES.SATURN_RING,
    shellRing: true,
    // Saturnian auroras — deep-blue hydrogen curtains on a nearly
    // axis-aligned dipole (Saturn's field tilts <1° off the pole).
    aurora: {
      color: SF_COLORS.AURORA_SATURN,
      colorLow: SF_COLORS.AURORA_SATURN_LOW,
      tilt: 0.02,
      lat: 0.86,
      intensity: 0.7,
    },
    phase: 2.2,
  },
  {
    id: 'uranus',
    name: 'Uranus',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 2.6,
    orbit: 148,
    speed: 0.11,
    spin: -1.4,
    tilt: 1.71,
    ecc: 0.046,
    dist: '19.2 AU',
    texture: SF_TEXTURES.URANUS,
    // Uranus's ring system — 13 razor-thin dark arcs hugging 1.6–2.0 R
    // (the ε ring sits at 1.95 R). No photo strip, so the seeded
    // procedural band painter supplies the dusty arcs.
    shellRing: true,
    ringInner: 1.55,
    ringOuter: 2.0,
    ringBands: 13,
    // Uranian auroras — the palest of the giants, teal curtains on a
    // dipole tilted ~59° off a spin axis already lying on its side.
    aurora: {
      color: SF_COLORS.AURORA_URANUS,
      colorLow: SF_COLORS.AURORA_URANUS_LOW,
      tilt: 1.03,
      lat: 0.78,
      intensity: 0.45,
    },
    phase: 4.9,
  },
  {
    id: 'neptune',
    name: 'Neptune',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.SOLAR,
    radius: 2.5,
    orbit: 166,
    speed: 0.078,
    spin: 1.5,
    // 28.3° — a modest tilt, nothing like Uranus's rollover.
    tilt: 0.49,
    ecc: 0.01,
    dist: '30.1 AU',
    texture: SF_TEXTURES.NEPTUNE,
    // Neptune's faint ring arcs — Le Verrier → Adams span ~1.7–2.4 R,
    // even more tenuous than Uranus's.
    shellRing: true,
    ringInner: 1.7,
    ringOuter: 2.4,
    ringBands: 5,
    // Neptunian auroras — faint violet-cyan curtains on a wildly offset
    // dipole (~47° tilt, offset half a radius), so the oval sits far off
    // the spin pole and wanders with longitude.
    aurora: {
      color: SF_COLORS.AURORA_NEPTUNE,
      colorLow: SF_COLORS.AURORA_NEPTUNE_LOW,
      tilt: 0.82,
      lat: 0.78,
      intensity: 0.55,
    },
    phase: 5.8,
  },
  {
    id: 'pluto',
    name: 'Pluto',
    kind: SF_KINDS.DWARF,
    group: SF_GROUPS.SOLAR,
    radius: 0.5,
    orbit: 234,
    speed: 0.064,
    // 119.6° — Pluto spins on its side like Uranus.
    tilt: 2.09,
    ecc: 0.249,
    dist: '39.5 AU',
    texture: SF_TEXTURES.PLUTO,
    phase: 1.5,
  },
  {
    id: 'phobos',
    name: 'Phobos',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.18,
    orbit: 2.4,
    parent: 'mars',
    speed: 4.2,
    ecc: 0.015,
    dist: '9 376 km',
    texture: SF_TEXTURES.PHOBOS,
    // Rubble pile on the edge of tidal disruption — real figure
    // 26.6 × 22.4 × 18.4 km ≈ [1, 0.84, 0.69], deeply cratered
    // (Stickney spans a third of the body): the highest crumple
    // amplitude on any catalog moon.
    irregular: { amp: 0.22, axes: [1, 0.84, 0.69] },
    meteors: true,
    phase: 0.6,
  },
  {
    id: 'deimos',
    name: 'Deimos',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.14,
    orbit: 3.4,
    parent: 'mars',
    // Deimos's year is ~4× Phobos's → sqrt ratio ≈ 0.5.
    speed: 2.1,
    ecc: 0.0003,
    dist: '23 460 km',
    texture: SF_TEXTURES.DEIMOS,
    // 15 × 12.2 × 11 km ≈ [1, 0.81, 0.73] — still unmistakably lumpy,
    // but regolith-blanketed so a gentler crumple than Phobos.
    irregular: { amp: 0.16, axes: [1, 0.81, 0.73] },
    meteors: true,
    phase: 2.4,
  },
  {
    id: 'vesta',
    name: 'Vesta',
    // Second-largest asteroid — a differentiated protoplanet, but NOT
    // hydrostatic (the Rheasilvia basin broke its figure), so it is an
    // asteroid in the official taxonomy, not a dwarf planet.
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.18,
    orbit: 73,
    speed: 0.53,
    tilt: 0.47,
    ecc: 0.089,
    dist: '2.36 AU',
    texture: SF_TEXTURES.VESTA,
    meteors: true,
    // Not quite a planet, not a ball — the Rheasilvia impact basin
    // flattened Vesta's south pole, so the protoplanet keeps a mild
    // triaxial crumple.
    irregular: { amp: 0.09, axes: [1, 0.9, 0.82] },
    phase: 2.7,
  },
  {
    id: 'io',
    name: 'Io',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.4,
    orbit: 7,
    parent: 'jupiter',
    speed: 3.8,
    ecc: 0.004,
    dist: '421 700 km',
    texture: SF_TEXTURES.IO,
    // The most volcanically active body in the system — sulfur/SO₂
    // plumes umbrella hundreds of km off scattered vents (Pele,
    // Prometheus), tinted sulfur-gold.
    plumes: { count: 7, color: SF_COLORS.PLUME_SULFUR, height: 1.4 },
    phase: 0.9,
  },
  {
    id: 'europa',
    name: 'Europa',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.36,
    orbit: 8.4,
    parent: 'jupiter',
    // Galilean periods 1.77/3.55/7.15/16.7 d → sqrt-ranked speeds.
    speed: 2.7,
    ecc: 0.009,
    dist: '671 000 km',
    texture: SF_TEXTURES.EUROPA,
    phase: 2.1,
  },
  {
    id: 'ganymede',
    name: 'Ganymede',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.55,
    orbit: 10,
    parent: 'jupiter',
    speed: 1.9,
    ecc: 0.001,
    dist: '1.07 Gm',
    texture: SF_TEXTURES.GANYMEDE,
    meteors: true,
    phase: 4.0,
  },
  {
    id: 'callisto',
    name: 'Callisto',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.52,
    orbit: 12,
    parent: 'jupiter',
    speed: 1.2,
    ecc: 0.007,
    dist: '1.88 Gm',
    // Most heavily cratered body in the system — the real Galileo
    // mosaic keeps Valhalla's concentric rings; meteors still hit it.
    texture: SF_TEXTURES.CALLISTO,
    meteors: true,
    phase: 5.2,
  },
  {
    id: 'mimas',
    name: 'Mimas',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.15,
    orbit: 9,
    parent: 'saturn',
    // Saturn's inner periods 0.94/1.37/2.74/4.5/16/79 d → the sqrt
    // ranking spreads 4.0 down to 0.44 across Mimas→Iapetus.
    speed: 4.0,
    // 0.02 — oddly eccentric for an inner moon; tides haven't
    // circularized it.
    ecc: 0.02,
    dist: '186 000 km',
    texture: SF_TEXTURES.MIMAS,
    meteors: true,
    phase: 1.1,
  },
  {
    id: 'enceladus',
    name: 'Enceladus',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.2,
    orbit: 10.2,
    parent: 'saturn',
    speed: 3.3,
    ecc: 0.005,
    dist: '238 000 km',
    texture: SF_TEXTURES.ENCELADUS,
    // South-polar tiger stripes vent water-ice geysers into space —
    // the plumes that feed Saturn's E ring. `polar` clusters the vents
    // around the −y pole like the real fractures.
    plumes: { count: 8, polar: true, color: SF_COLORS.PLUME_ICE, height: 2.4 },
    phase: 2.9,
  },
  {
    id: 'dione',
    name: 'Dione',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.22,
    orbit: 11.4,
    parent: 'saturn',
    speed: 2.3,
    ecc: 0.002,
    dist: '377 000 km',
    texture: SF_TEXTURES.DIONE,
    meteors: true,
    phase: 4.6,
  },
  {
    id: 'rhea',
    name: 'Rhea',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.26,
    orbit: 12.8,
    parent: 'saturn',
    speed: 1.8,
    ecc: 0.001,
    dist: '527 000 km',
    texture: SF_TEXTURES.RHEA,
    meteors: true,
    phase: 0.4,
  },
  {
    id: 'titan',
    name: 'Titan',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.55,
    orbit: 15,
    parent: 'saturn',
    speed: 0.97,
    ecc: 0.029,
    dist: '1.22 Gm',
    texture: SF_TEXTURES.TITAN,
    // The texture IS the tholin haze — Voyager/Cassini see an opaque
    // orange photochemical smog ball. The rim shell keeps the orange
    // honest (`atmoColor` pins the limb tint) and lifts it past the
    // surface so Titan reads as the only moon with a thick atmosphere,
    // not a painted orange sphere.
    atmosphere: 1.5,
    atmoColor: SF_COLORS.TITAN_HAZE,
    phase: 3.3,
  },
  {
    id: 'iapetus',
    name: 'Iapetus',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.3,
    orbit: 18,
    parent: 'saturn',
    speed: 0.44,
    ecc: 0.028,
    dist: '3.56 Gm',
    texture: SF_TEXTURES.IAPETUS,
    meteors: true,
    phase: 5.8,
  },
  {
    id: 'triton',
    name: 'Triton',
    kind: SF_KINDS.MOON,
    group: SF_GROUPS.SOLAR,
    radius: 0.38,
    orbit: 6.5,
    parent: 'neptune',
    // Triton orbits BACKWARDS — a captured Kuiper-belt object on a
    // retrograde, nearly perfectly circularized path.
    speed: -2.6,
    ecc: 0.00002,
    dist: '354 800 km',
    texture: SF_TEXTURES.TRITON,
    phase: 1.9,
  },
  {
    id: 'ryugu',
    name: 'Ryugu',
    // C-type near-Earth asteroid — a rubble pile, not a dwarf planet.
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.07,
    orbit: 48,
    speed: 0.88,
    ecc: 0.19,
    // Real orbit tips 5.88° off the ecliptic — without it the NEO rides
    // visually inside Earth's ring (44) and reads as a collision course;
    // the inclination lifts its crossings clear of the planet's plane.
    inc: 0.103,
    dist: '1.19 AU',
    texture: SF_TEXTURES.RYUGU,
    meteors: true,
    // Hayabusa2's target — a spinning-top rubble pile whose equatorial
    // ridge and strongly oblate figure (~880×880×460 m) must never read
    // as a hydrostatic ball.
    irregular: { amp: 0.16, axes: [1, 0.9, 0.55] },
    phase: 5.5,
  },
  {
    id: 'bennu',
    name: 'Bennu',
    // B-type carbonaceous asteroid — OSIRIS-REx's rubble pile.
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.06,
    orbit: 46,
    speed: 0.91,
    ecc: 0.204,
    // Real 6.03° inclination — keeps the NEO's ring visually clear of
    // Earth's orbit (44) instead of traversing it at every crossing.
    inc: 0.105,
    dist: '1.13 AU',
    texture: SF_TEXTURES.BENNU,
    meteors: true,
    // OSIRIS-REx's spinning-top rubble pile — equatorial ridge, mild
    // oblateness; crumpled like its sibling Ryugu.
    irregular: { amp: 0.13, axes: [1, 0.94, 0.98] },
    phase: 2.2,
  },
  {
    // Halley's Comet — the chart's flagship eccentric body: `orbit` is the
    // semi-major axis and `ecc` drives the conic radius in frame.ts, so it
    // plunges to a Venus-ward periapsis (~0.59 AU, between Mercury and
    // Venus on the chart) then coasts out past Neptune into the Kuiper
    // belt (~35 AU) on a 75-year sweep. The COMET kind swaps the planet
    // sphere for an irregular nucleus + coma + ion/dust tails that
    // stream anti-sunward and flare at periapsis.
    id: 'halley',
    name: "Halley's Comet",
    kind: SF_KINDS.COMET,
    group: SF_GROUPS.SOLAR,
    // Nucleus is chart-exaggerated (real ~8 km) so the tails — scaled
    // off this radius — stretch far enough to read at select distance.
    radius: 0.4,
    orbit: 180,
    speed: 0.5,
    ecc: 0.83,
    spin: 0.8,
    // Real Halley is retrograde at 162° — the steep inclination lifts
    // its eccentric ellipse out of the ecliptic so it dives through the
    // planetary planes instead of tracing a ring inside them.
    inc: 2.83,
    dist: '0.59–35.1 AU',
    color: SF_COLORS.HALLEY,
    // The nucleus is a 15×8×8 km rubble brick — Giotto's "potato" —
    // crumpled hard along its short axes.
    irregular: { amp: 0.22, axes: [1, 0.5, 0.55] },
    phase: 4.4,
  },
  // ── Named belt residents — the debris fields' clickable members ──
  {
    // Pallas — 2nd discovered, ~512 km of B-type basaltic rock on the
    // belt's wildest orbit: real inclination 34.8° (0.607 rad) pitches
    // its ring far off the ecliptic, so it dives through the planet
    // planes instead of cruising between them.
    id: 'pallas',
    name: 'Pallas',
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.16,
    orbit: 71.5,
    speed: 0.49,
    ecc: 0.231,
    inc: 0.607,
    dist: '2.77 AU',
    color: SF_COLORS.PALLAS,
    surface: SF_SURFACES.ROCK,
    meteors: true,
    irregular: { amp: 0.1, axes: [1, 0.94, 0.87] },
    phase: 0.8,
  },
  {
    // Juno — ~234 km S-type stony-iron body, 3rd discovered; the real
    // orbit is steeply eccentric for a belt resident (0.256) so its
    // ring visibly stretches inside the band instead of circling it.
    id: 'juno',
    name: 'Juno',
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.11,
    orbit: 68,
    speed: 0.55,
    ecc: 0.256,
    inc: 0.227,
    dist: '2.67 AU',
    color: SF_COLORS.JUNO,
    surface: SF_SURFACES.ROCK,
    meteors: true,
    irregular: { amp: 0.14, axes: [1, 0.85, 0.7] },
    phase: 3.6,
  },
  {
    // Hygiea — 4th-largest, ~434 km of dark C-type carbon; nearly round
    // (2019 imaging showed it almost hydrostatic) but it rides the
    // outer edge where Ceres-mass bodies thin out.
    id: 'hygiea',
    name: 'Hygiea',
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.13,
    orbit: 76.5,
    speed: 0.44,
    ecc: 0.112,
    inc: 0.066,
    dist: '3.14 AU',
    color: SF_COLORS.HYGIEA,
    surface: SF_SURFACES.ROCK,
    meteors: true,
    irregular: { amp: 0.06, axes: [1, 0.97, 0.93] },
    phase: 1.7,
  },
  {
    // Eros — the NEAR Shoemaker orbiter's target: a 34×11×11 km NEO
    // peanut (~[1, 0.32, 0.32]) that swings through Mars' crossing zone
    // on a 10.8°-tipped orbit; the strong elongation must never read
    // as a ball.
    id: 'eros',
    name: 'Eros',
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.05,
    orbit: 52,
    speed: 1.05,
    ecc: 0.223,
    inc: 0.188,
    dist: '1.46 AU',
    color: SF_COLORS.EROS,
    surface: SF_SURFACES.ROCK,
    meteors: true,
    irregular: { amp: 0.2, axes: [1, 0.32, 0.32] },
    phase: 4.9,
  },
  // ── Kuiper-belt residents — real TNOs riding the outer band ──
  {
    // Haumea — the collapsed-Jacobi ellipsoid: a 1960×1518×996 km
    // cigar spinning a 3.9-hour day, sheathed in crystalline water
    // ice (streaks recipe paints the bright fractured crust).
    id: 'haumea',
    name: 'Haumea',
    kind: SF_KINDS.DWARF,
    group: SF_GROUPS.SOLAR,
    radius: 0.3,
    orbit: 320,
    speed: 0.3,
    ecc: 0.195,
    inc: 0.492,
    // The fastest spinner in the catalog — the real day is 3.9 h.
    spin: 6,
    dist: '43.3 AU',
    color: SF_COLORS.HAUMEA,
    surface: SF_SURFACES.ICE,
    irregular: { amp: 0.1, axes: [1, 0.77, 0.51] },
    phase: 2.9,
  },
  {
    // Makemake — methane-ice dwarf on a 45.7 AU orbit; the red tholin
    // frost layer over dark rock is the second-brightest KBO after
    // Pluto.
    id: 'makemake',
    name: 'Makemake',
    kind: SF_KINDS.DWARF,
    group: SF_GROUPS.SOLAR,
    radius: 0.28,
    orbit: 340,
    speed: 0.26,
    ecc: 0.159,
    inc: 0.505,
    dist: '45.7 AU',
    color: SF_COLORS.MAKEMAKE,
    surface: SF_SURFACES.ICE,
    irregular: { amp: 0.07, axes: [1, 0.93, 0.9] },
    phase: 5.8,
  },
  {
    // Eris — the scattered-disc dwarf whose discovery forced Pluto's
    // reclassification: a 44°-inclined 0.44-eccentric orbit carries it
    // from 38 AU out to 98 AU, so its chart ellipse dwarfs the belt.
    id: 'eris',
    name: 'Eris',
    kind: SF_KINDS.DWARF,
    group: SF_GROUPS.SOLAR,
    radius: 0.29,
    orbit: 430,
    speed: 0.19,
    ecc: 0.436,
    inc: 0.77,
    dist: '67.7 AU',
    color: SF_COLORS.ERIS,
    surface: SF_SURFACES.ICE,
    phase: 0.4,
  },
  {
    // Arrokoth — the New Horizons flyby contact binary: two fused
    // planetesimal lobes (the deep neck groove) coated in cold-
    // classical rust-red tholins; the bilobed amp reads as a snowman.
    id: 'arrokoth',
    name: 'Arrokoth',
    kind: SF_KINDS.ASTEROID,
    group: SF_GROUPS.SOLAR,
    radius: 0.03,
    orbit: 315,
    speed: 0.31,
    ecc: 0.042,
    inc: 0.043,
    dist: '44.6 AU',
    color: SF_COLORS.ARROKOTH,
    surface: SF_SURFACES.ROCK,
    irregular: { amp: 0.28, axes: [1, 0.45, 0.55] },
    phase: 1.2,
  },
  {
    id: 'asteroid-belt',
    name: 'Asteroid Belt',
    kind: SF_KINDS.BELT,
    group: SF_GROUPS.SOLAR,
    radius: 12,
    pos: [0, 0, 0],
    spin: 0.015,
    dist: '2.06–3.27 AU',
    color: SF_COLORS.ASTEROID_BELT,
    // ~140k points — dense enough that the belt reads as a continuous
    // rubble band at the home camera, not a sparse scatter; the WASM
    // fill worker generates the whole field in one batch.
    belt: { inner: 66, outer: 78, count: 14000 },
  },
  {
    id: 'kuiper-belt',
    name: 'Kuiper Belt',
    kind: SF_KINDS.BELT,
    group: SF_GROUPS.SOLAR,
    radius: 30,
    pos: [0, 0, 0],
    spin: 0.006,
    dist: '30–55 AU',
    color: SF_COLORS.KUIPER_BELT,
    belt: { inner: 300, outer: 380, count: 18000, puff: 0.28, gapFreq: 0 },
  },
]

/** Solar tier at render scale — every def run through `shrinkSolar`. */
export const SOLAR: SFBodyDef[] = SOLAR_RAW.map(shrinkSolar)
