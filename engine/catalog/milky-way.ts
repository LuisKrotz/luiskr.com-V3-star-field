/**
 * @file engine/catalog/milky-way.ts
 * @description Milky Way neighborhood — famous nearby systems at
 * their real galactic (l, b, distance) coordinates through `gpos`.
 * Split out of catalog.ts.
 */

import { SF_COLORS } from '@core/tokens/starfield/params.js'
import { SF_TEXTURES } from '@core/tokens/starfield/textures.js'
import { SF_GROUPS, SF_KINDS } from '@core/tokens/starfield/kinds.js'
import type { SFBodyDef } from '../types.js'
import { gpos } from './geo.js'

/**
 * Milky Way neighborhood — famous nearby systems at their real galactic
 * (l, b, distance) coordinates through `gpos`. Every star sits at its
 * honest compressed distance (Proxima 0.042 units, Deneb 26.15) so the
 * chart never lies about who's next to whom — no stars render inside
 * the solar diagram. Marker radii are point-scale glyphs (~0.01–0.05
 * units, physically a star is far smaller) sized by luminosity class so
 * giants still read bigger than dwarfs; pickability comes from the
 * radius-scaled invisible proxy, not inflated geometry.
 *
 * Two LOD faces per star (see `buildStarBodies`): the flat point-glow
 * carries the chart view, while a seeded photosphere — granulation,
 * sunspot groups past the `activity` threshold, `rim` limb darkening,
 * corona and flares — resolves on approach and `spin` visibly turns the
 * surface. Planets and stellar companions are real parented bodies with
 * their own eccentric orbits, so every authored system simulates its
 * members rather than decorating the star's glyph.
 */
export const MILKY_WAY: SFBodyDef[] = [
  {
    // Alpha Centauri A — Rigil Kentaurus, G2V, ~1.1 M☉: slightly bigger
    // and more luminous than the Sun. It anchors the triple hierarchy —
    // B orbits it on the real 79.9-yr eccentric track and Proxima rides
    // far outside the pair, so from interstellar range the system merges
    // into the single point of light southern observers see naked-eye.
    id: 'alpha-centauri',
    name: 'Alpha Centauri',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 14,
    pos: gpos(315.73, -0.68, 4.37),
    dist: '4.37 ly',
    color: SF_COLORS.ALPHA_STAR,
    spin: 0.3,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Alpha Centauri B — Toliman, K1V, ~0.9 M☉: smaller, cooler, orange.
    // A parented orbit (not a decorative satellite) so the pair really
    // sweeps a shared barycentric track — real eccentricity e≈0.518.
    // K dwarfs run a little more magnetically active than G twins.
    id: 'alpha-centauri-b',
    name: 'Alpha Centauri B',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 9,
    parent: 'alpha-centauri',
    orbit: 26,
    speed: 0.5,
    ecc: 0.518,
    phase: 1.9,
    dist: '4.40 ly',
    color: SF_COLORS.ALPHA_COMPANION,
    spin: 0.35,
    activity: 1.2,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Proxima — α Cen C, M5.5V red dwarf, gravitationally bound to the
    // AB pair at ~13 000 AU (≈0.21 ly). Its orbit is hugely exaggerated
    // versus the AB separation (real ratio ~550:1 won't fit a glyph),
    // but the ordering is honest: the binary is a tight inner pair and
    // Proxima a remote third light — e≈0.5, ~550 000-yr period, so its
    // crawl against the 80-yr waltz is nearly imperceptible. A flare
    // star: high activity spots the photosphere and live prominences
    // crown the limb on approach.
    id: 'proxima-centauri',
    name: 'Proxima Centauri',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 2.5,
    parent: 'alpha-centauri',
    orbit: 84,
    speed: 0.05,
    ecc: 0.5,
    phase: 4.1,
    dist: '4.246 ly',
    color: SF_COLORS.PROXIMA_STAR,
    spin: 0.15,
    activity: 2.4,
    rim: SF_COLORS.STAR_LIMB,
    flares: true,
  },
  {
    // Proxima d — innermost confirmed planet (0.029 AU, 5.1-day year,
    // sub-Earth mass) — orbits the dim red dwarf, not the bright pair.
    id: 'proxima-d',
    name: 'Proxima d',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.4,
    parent: 'proxima-centauri',
    orbit: 6,
    speed: 2.6,
    ecc: 0.04,
    phase: 0.8,
    dist: '4.246 ly',
    color: SF_COLORS.PROXIMA_PLANET,
  },
  {
    // Proxima b — the famous one: 1.07 M⊕ inside the habitable zone,
    // 11.2-day year, almost certainly tidally locked (the shared lock
    // group already gives it that physics for free).
    id: 'proxima-b',
    name: 'Proxima b',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.7,
    parent: 'proxima-centauri',
    orbit: 8.5,
    speed: 1.7,
    ecc: 0.11,
    phase: 2.9,
    dist: '4.246 ly',
    color: SF_COLORS.PROXIMA_PLANET,
  },
  {
    // Proxima c — outer candidate (~1.5 AU, ~5.7-yr year, ~7 M⊕
    // mini-Neptune): the slow, distant, biggest sibling.
    id: 'proxima-c',
    name: 'Proxima c',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 1.1,
    parent: 'proxima-centauri',
    orbit: 14,
    speed: 0.35,
    ecc: 0.3,
    phase: 5.3,
    dist: '4.246 ly',
    color: SF_COLORS.PROXIMA_PLANET,
  },
  {
    // Sirius A — A1V main-sequence star, the brightest in Earth's night
    // sky and a real binary: its faint white-dwarf companion (the Pup)
    // orbits on the true e≈0.59 track. Hot star — quiet surface, no limb
    // darkening override so the rim keeps the hot white photosphere tint.
    id: 'sirius',
    name: 'Sirius',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 18,
    pos: gpos(227.23, -8.89, 8.6),
    dist: '8.6 ly',
    color: SF_COLORS.SIRIUS,
    spin: 0.3,
    activity: 0.8,
  },
  {
    // Sirius B — the Pup: the first white dwarf ever recognized, an
    // Earth-mass cinder in a 50-yr orbit (real e≈0.59). Still hot — it
    // shines white-blue, a pinpoint beside its giant sibling.
    id: 'sirius-b',
    name: 'Sirius B',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 1.5,
    parent: 'sirius',
    orbit: 80,
    speed: 0.9,
    ecc: 0.59,
    phase: 0.6,
    dist: '8.6 ly',
    color: SF_COLORS.STAR_WHITE,
    spin: 0.8,
  },
  {
    // Vega — A0V, the archetypal white standard star and one of the
    // fastest-spinning bright stars (about 90% of breakup, so its disc
    // rotation reads faster than the Sun-like dwarfs).
    id: 'vega',
    name: 'Vega',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 20,
    pos: gpos(67.45, 19.24, 25.04),
    dist: '25 ly',
    color: SF_COLORS.VEGA,
    spin: 0.4,
    activity: 0.8,
  },
  {
    // Betelgeuse — M1–M2 red supergiant: enormous convection cells (high
    // activity → big sunspot blotches), a slow rotation crawl, limb
    // darkening and the 400-day semi-regular pulsation it is famous for.
    id: 'betelgeuse',
    name: 'Betelgeuse',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 80,
    pos: gpos(199.79, -9.0, 548),
    dist: '548 ly',
    color: SF_COLORS.BETELGEUSE,
    spin: 0.1,
    activity: 1.5,
    rim: SF_COLORS.STAR_LIMB,
    pulse: { period: 4.2, amp: 0.06 },
  },
  {
    // TRAPPIST-1 — M8V ultracool dwarf hosting seven Earth-sized
    // planets, the richest compact system known. A flare star: the high
    // activity spots its photosphere and prominences crown the limb.
    id: 'trappist-1',
    name: 'TRAPPIST-1',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 2.5,
    pos: gpos(74.9, -60.4, 40.7),
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_STAR,
    spin: 0.4,
    activity: 2.4,
    rim: SF_COLORS.STAR_LIMB,
    flares: true,
  },
  {
    // TRAPPIST-1b — innermost of the seven resonant worlds: 1.5-day
    // year, ~1.1 R⊕, scorched face toward the dwarf. All seven planets
    // are real parented bodies on near-circular orbits whose speeds rank
    // by the true periods (1.51 → 18.77 days).
    id: 'trappist-1b',
    name: 'TRAPPIST-1b',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.5,
    parent: 'trappist-1',
    orbit: 6,
    speed: 2.6,
    ecc: 0.006,
    phase: 0.2,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // TRAPPIST-1c — 2.4-day year, Venus-mass sibling just outside b.
    id: 'trappist-1c',
    name: 'TRAPPIST-1c',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.55,
    parent: 'trappist-1',
    orbit: 8,
    speed: 1.6,
    ecc: 0.007,
    phase: 0.9,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // TRAPPIST-1d — 4.05-day year, the lightest of the seven (~0.3 M⊕).
    id: 'trappist-1d',
    name: 'TRAPPIST-1d',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.55,
    parent: 'trappist-1',
    orbit: 10,
    speed: 0.97,
    ecc: 0.008,
    phase: 2.1,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // TRAPPIST-1e — 6.1-day year, the densest Earth-like member and the
    // system's best candidate for liquid water.
    id: 'trappist-1e',
    name: 'TRAPPIST-1e',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.6,
    parent: 'trappist-1',
    orbit: 12,
    speed: 0.64,
    ecc: 0.005,
    phase: 3.4,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // TRAPPIST-1f — 9.2-day year, a water-rich world on the habitable
    // zone's inner edge.
    id: 'trappist-1f',
    name: 'TRAPPIST-1f',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.6,
    parent: 'trappist-1',
    orbit: 14,
    speed: 0.42,
    ecc: 0.01,
    phase: 4.6,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // TRAPPIST-1g — 12.4-day year, the largest of the seven (~1.15 R⊕).
    id: 'trappist-1g',
    name: 'TRAPPIST-1g',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.65,
    parent: 'trappist-1',
    orbit: 16,
    speed: 0.31,
    ecc: 0.002,
    phase: 5.5,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // TRAPPIST-1h — 18.8-day year, the cold outer edge of the resonant
    // chain, likely cloaked in ice.
    id: 'trappist-1h',
    name: 'TRAPPIST-1h',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.65,
    parent: 'trappist-1',
    orbit: 18,
    speed: 0.2,
    ecc: 0.006,
    phase: 1.2,
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_PLANET,
  },
  {
    // Barnard's Star — M4V, the closest lone star and fastest mover
    // across our sky. Old but still an occasional flare star (a
    // documented superflare), and it hosts a confirmed sub-Earth planet.
    id: 'barnard-star',
    name: "Barnard's Star",
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 2.5,
    pos: gpos(31.01, 14.06, 5.96),
    dist: '5.96 ly',
    color: SF_COLORS.BARNARD_STAR,
    spin: 0.2,
    activity: 1.7,
    rim: SF_COLORS.STAR_LIMB,
    flares: true,
  },
  {
    // Barnard b — the confirmed sub-Earth (~0.3 M⊕) orbiting every
    // 3.15 days; 2024's ESPRESSO confirmation ended a century of
    // retracted claims. Its real eccentricity is unclear — a modest
    // ellipse keeps the orbit honest rather than circular.
    id: 'barnard-b',
    name: 'Barnard b',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.4,
    parent: 'barnard-star',
    orbit: 6,
    speed: 2.8,
    ecc: 0.3,
    phase: 2.4,
    dist: '5.96 ly',
    color: SF_COLORS.PROXIMA_PLANET,
  },
  {
    // Epsilon Eridani — K2V, the nearest young Sun-like star (~800 Myr),
    // wrapped in dust belts and still magnetically lively. Ægir rides
    // its real e≈0.26 track.
    id: 'epsilon-eridani',
    name: 'Epsilon Eridani',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 10,
    pos: gpos(195.84, -48.05, 10.5),
    dist: '10.5 ly',
    color: SF_COLORS.EPS_ERI,
    spin: 0.3,
    activity: 1.9,
    rim: SF_COLORS.STAR_LIMB,
    flares: true,
  },
  {
    // Epsilon Eridani b (Ægir) — a ~0.8 M♃ gas giant on a 7.4-yr,
    // e≈0.26 ellipse, swinging between ~1.0 and ~4.6 AU: the visible
    // eccentricity is honest, not a decorative circle.
    id: 'eps-eridani-b',
    name: 'Epsilon Eridani b',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 1.2,
    parent: 'epsilon-eridani',
    orbit: 20,
    speed: 1.2,
    ecc: 0.26,
    phase: 0.7,
    dist: '10.5 ly',
    color: SF_COLORS.EPS_ERI_PLANET,
  },
  {
    // Tau Ceti — G8.5V, a quiet old Sun analog with the nearest
    // habitable-zone super-Earth candidates. Low activity — clean,
    // softly mottled disc.
    id: 'tau-ceti',
    name: 'Tau Ceti',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 10,
    pos: gpos(173.1, -73.44, 11.9),
    dist: '11.9 ly',
    color: SF_COLORS.TAU_CETI,
    spin: 0.25,
    activity: 0.75,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Tau Ceti e — habitable-zone super-Earth candidate (~4 M⊕, 163-day
    // year at 0.55 AU).
    id: 'tau-ceti-e',
    name: 'Tau Ceti e',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.6,
    parent: 'tau-ceti',
    orbit: 18,
    speed: 1.5,
    ecc: 0.05,
    phase: 0.4,
    dist: '11.9 ly',
    color: SF_COLORS.TAU_CETI_PLANET,
  },
  {
    // Tau Ceti f — outer candidate (~6.6 M⊕, 636-day year at 1.35 AU) on
    // the cool edge of the zone.
    id: 'tau-ceti-f',
    name: 'Tau Ceti f',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 0.7,
    parent: 'tau-ceti',
    orbit: 28,
    speed: 1.0,
    ecc: 0.08,
    phase: 3.4,
    dist: '11.9 ly',
    color: SF_COLORS.TAU_CETI_PLANET,
  },
  {
    // Arcturus — K1.5III red giant, the brightest star of the northern
    // sky: an expanded orange photosphere ~25× the Sun's radius.
    id: 'arcturus',
    name: 'Arcturus',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 35,
    pos: gpos(15.07, 69.11, 36.7),
    dist: '36.7 ly',
    color: SF_COLORS.ARCTURUS,
    spin: 0.15,
    activity: 1.0,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // 51 Pegasi — the first Sun-like star found with an exoplanet
    // (Mayor & Queloz, 1995); a G2.5IV subgiant, slightly evolved off
    // the main sequence.
    id: '51-pegasi',
    name: '51 Pegasi',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 12,
    pos: gpos(92.9, -30.8, 50.9),
    dist: '50.9 ly',
    color: SF_COLORS.PEGASI_STAR,
    spin: 0.25,
    activity: 0.9,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // 51 Pegasi b (Dimidium) — the original hot Jupiter: ~0.47 M♃
    // parked at 0.052 AU on a 4.23-day, near-circular orbit.
    id: '51-pegasi-b',
    name: '51 Pegasi b',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 1.8,
    parent: '51-pegasi',
    orbit: 22,
    speed: 2.6,
    ecc: 0.013,
    phase: 0.9,
    dist: '50.9 ly',
    color: SF_COLORS.PEGASI_PLANET,
  },
  {
    // Aldebaran — K5III orange giant in Taurus, the "follower" of the
    // Pleiades: a slow-spinning swollen photosphere ~44× the Sun.
    id: 'aldebaran',
    name: 'Aldebaran',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 40,
    pos: gpos(180.97, -20.35, 65),
    dist: '65 ly',
    color: SF_COLORS.ALDEBARAN,
    spin: 0.1,
    activity: 1.0,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Capella — the famous golden pair: twin G giants (Aa + Ab) waltzing
    // every 104 days on an almost perfectly circular orbit.
    id: 'capella',
    name: 'Capella',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 25,
    pos: gpos(162.6, 4.57, 42.9),
    dist: '42.9 ly',
    color: SF_COLORS.CAPELLA,
    spin: 0.25,
    activity: 1.1,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Capella Ab — the slightly lighter twin (G8III): nearly the same
    // size and color as its sibling, so the pair reads as two golden
    // suns circling each other — real e≈0.001, essentially circular.
    id: 'capella-b',
    name: 'Capella Ab',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 22,
    parent: 'capella',
    orbit: 120,
    speed: 0.6,
    ecc: 0.01,
    phase: 2.2,
    dist: '42.9 ly',
    color: SF_COLORS.CAPELLA,
    spin: 0.25,
    activity: 1.1,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Canopus — F0Ib bright giant, the second-brightest star in the sky:
    // a pale white supergiant nearly 10 000× the Sun's luminosity.
    id: 'canopus',
    name: 'Canopus',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 45,
    pos: gpos(261.21, -25.3, 310),
    dist: '310 ly',
    color: SF_COLORS.CANOPUS,
    spin: 0.2,
    activity: 0.9,
  },
  {
    // Polaris — F7Ib Cepheid: the pole star pulses every 3.97 days with
    // a gentle light swing, and its close companion Ab traces a steep
    // e≈0.61 ellipse around it.
    id: 'polaris',
    name: 'Polaris',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 35,
    pos: gpos(123.28, 26.46, 447),
    dist: '447 ly',
    color: SF_COLORS.POLARIS,
    spin: 0.2,
    activity: 1.0,
    rim: SF_COLORS.STAR_LIMB,
    pulse: { period: 3.97, amp: 0.03 },
  },
  {
    // Polaris Ab — the close F6V dwarf resolved only by Hubble, ~18 AU
    // from the Cepheid on the real e≈0.61 track (Polaris B, the wide
    // telescopic companion, lies far outside this glyph scale).
    id: 'polaris-ab',
    name: 'Polaris Ab',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 4,
    parent: 'polaris',
    orbit: 140,
    speed: 0.7,
    ecc: 0.61,
    phase: 1.1,
    dist: '447 ly',
    color: SF_COLORS.STAR_GOLD,
    spin: 0.5,
  },
  {
    // Antares — M1.5Iab red supergiant, the "rival of Mars": a bloated
    // seething surface ~680 R☉ with its B2.5V companion circling far
    // outside the photosphere.
    id: 'antares',
    name: 'Antares',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 75,
    pos: gpos(351.95, 15.06, 550),
    dist: '550 ly',
    color: SF_COLORS.ANTARES,
    spin: 0.08,
    activity: 1.5,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Antares B — the B2.5V companion, greenish-white beside the
    // supergiant's red glare, ~550 AU out on its long slow track.
    id: 'antares-b',
    name: 'Antares B',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 8,
    parent: 'antares',
    orbit: 300,
    speed: 0.5,
    ecc: 0.2,
    phase: 4.0,
    dist: '550 ly',
    color: SF_COLORS.RIGEL,
    spin: 0.4,
  },
  {
    // Rigel — B8Ia blue supergiant in Orion: a searing white-blue
    // photosphere ~79 R☉, the luminous base of the hunter's foot.
    id: 'rigel',
    name: 'Rigel',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 50,
    pos: gpos(209.24, -25.25, 863),
    dist: '863 ly',
    color: SF_COLORS.RIGEL,
    spin: 0.15,
    activity: 1.1,
  },
  {
    // Deneb — A2Ia white supergiant, one of the most luminous stars
    // visible to the naked eye: ~200 000 L☉ blazing across 2 600 ly.
    id: 'deneb',
    name: 'Deneb',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 60,
    pos: gpos(84.28, 1.99, 2615),
    dist: '2 615 ly',
    color: SF_COLORS.DENEB,
    spin: 0.15,
    activity: 1.0,
  },
  {
    // Kepler-452 — a G2V Sun twin (~1.04 M☉, ~20% more luminous) hosting
    // the first Earth-sized world found in a Sun-like habitable zone.
    // Wears the real solar photosphere map (same spectral class, honest
    // stand-in) re-tinted to its paler gold by the fresnel material so
    // the disc resolves as a textured star, not a bare glow point.
    id: 'kepler-452',
    name: 'Kepler-452',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 12,
    pos: gpos(79.41, 11.72, 1800),
    dist: '1 800 ly',
    texture: SF_TEXTURES.SUN,
    color: SF_COLORS.KEPLER_STAR,
    spin: 0.3,
    activity: 1.0,
    rim: SF_COLORS.STAR_LIMB,
  },
  {
    // Kepler-452b — "Earth's cousin": ~1.6 R⊕ on a 385-day orbit inside
    // its G2 star's habitable zone, ~60% larger than Earth.
    id: 'kepler-452-b',
    name: 'Kepler-452b',
    kind: SF_KINDS.PLANET,
    group: SF_GROUPS.MILKY_WAY,
    radius: 1.2,
    parent: 'kepler-452',
    orbit: 22,
    speed: 0.8,
    ecc: 0.03,
    phase: 1.4,
    dist: '1 800 ly',
    color: SF_COLORS.KEPLER_PLANET,
  },
]
