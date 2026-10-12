/**
 * @file engine/catalog/milky-way.ts
 * @description Milky Way neighborhood — famous nearby systems at
 * their real galactic (l, b, distance) coordinates through `gpos`.
 * Split out of catalog.ts.
 */

import { SF_COLORS } from '@core/tokens/starfield/params.js'
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
 * radius-scaled invisible proxy, not inflated geometry. `satellites`
 * dress each system with orbiting companions at matching glyph scale.
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
  },
  {
    // Alpha Centauri B — Toliman, K1V, ~0.9 M☉: smaller, cooler, orange.
    // A parented orbit (not a decorative satellite) so the pair really
    // sweeps a shared barycentric track — real eccentricity e≈0.518.
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
  },
  {
    // Proxima — α Cen C, M5.5V red dwarf, gravitationally bound to the
    // AB pair at ~13 000 AU (≈0.21 ly). Its orbit is hugely exaggerated
    // versus the AB separation (real ratio ~550:1 won't fit a glyph),
    // but the ordering is honest: the binary is a tight inner pair and
    // Proxima a remote third light — e≈0.5, ~550 000-yr period, so its
    // crawl against the 80-yr waltz is nearly imperceptible.
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
    id: 'sirius',
    name: 'Sirius',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 18,
    pos: gpos(227.23, -8.89, 8.6),
    dist: '8.6 ly',
    color: SF_COLORS.SIRIUS,
    spin: 0.3,
  },
  {
    id: 'vega',
    name: 'Vega',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 20,
    pos: gpos(67.45, 19.24, 25.04),
    dist: '25 ly',
    color: SF_COLORS.VEGA,
    spin: 0.4,
  },
  {
    id: 'betelgeuse',
    name: 'Betelgeuse',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 80,
    pos: gpos(199.79, -9.0, 548),
    dist: '548 ly',
    color: SF_COLORS.BETELGEUSE,
    spin: 0.1,
    pulse: { period: 4.2, amp: 0.06 },
  },
  {
    id: 'trappist-1',
    name: 'TRAPPIST-1',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 2.5,
    pos: gpos(74.9, -60.4, 40.7),
    dist: '40.7 ly',
    color: SF_COLORS.TRAPPIST_STAR,
    satellites: [
      { radius: 0.5, orbit: 6, speed: 2.6, color: SF_COLORS.TRAPPIST_PLANET },
      { radius: 0.55, orbit: 8, speed: 1.6, color: SF_COLORS.TRAPPIST_PLANET, phase: 0.9 },
      { radius: 0.55, orbit: 10, speed: 0.97, color: SF_COLORS.TRAPPIST_PLANET, phase: 2.1 },
      { radius: 0.6, orbit: 12, speed: 0.64, color: SF_COLORS.TRAPPIST_PLANET, phase: 3.4 },
      { radius: 0.6, orbit: 14, speed: 0.42, color: SF_COLORS.TRAPPIST_PLANET, phase: 4.6 },
      { radius: 0.65, orbit: 16, speed: 0.31, color: SF_COLORS.TRAPPIST_PLANET, phase: 5.5 },
      { radius: 0.65, orbit: 18, speed: 0.2, color: SF_COLORS.TRAPPIST_PLANET, phase: 1.2 },
    ],
  },
  {
    id: 'barnard-star',
    name: "Barnard's Star",
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 2.5,
    pos: gpos(31.01, 14.06, 5.96),
    dist: '5.96 ly',
    color: SF_COLORS.BARNARD_STAR,
    spin: 0.2,
  },
  {
    id: 'epsilon-eridani',
    name: 'Epsilon Eridani',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 10,
    pos: gpos(195.84, -48.05, 10.5),
    dist: '10.5 ly',
    color: SF_COLORS.EPS_ERI,
    satellites: [{ radius: 1.2, orbit: 20, speed: 1.2, color: SF_COLORS.EPS_ERI_PLANET }],
  },
  {
    id: 'tau-ceti',
    name: 'Tau Ceti',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 10,
    pos: gpos(173.1, -73.44, 11.9),
    dist: '11.9 ly',
    color: SF_COLORS.TAU_CETI,
    satellites: [
      { radius: 1.2, orbit: 18, speed: 1.5, color: SF_COLORS.TAU_CETI_PLANET },
      { radius: 1.4, orbit: 28, speed: 1.0, color: SF_COLORS.TAU_CETI_PLANET, phase: 3.4 },
    ],
  },
  {
    id: 'arcturus',
    name: 'Arcturus',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 35,
    pos: gpos(15.07, 69.11, 36.7),
    dist: '36.7 ly',
    color: SF_COLORS.ARCTURUS,
    spin: 0.15,
  },
  {
    id: '51-pegasi',
    name: '51 Pegasi',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 12,
    pos: gpos(92.9, -30.8, 50.9),
    dist: '50.9 ly',
    color: SF_COLORS.PEGASI_STAR,
    satellites: [{ radius: 1.8, orbit: 22, speed: 2.6, color: SF_COLORS.PEGASI_PLANET }],
  },
  {
    id: 'aldebaran',
    name: 'Aldebaran',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 40,
    pos: gpos(180.97, -20.35, 65),
    dist: '65 ly',
    color: SF_COLORS.ALDEBARAN,
    spin: 0.1,
  },
  {
    id: 'capella',
    name: 'Capella',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 25,
    pos: gpos(162.6, 4.57, 42.9),
    dist: '42.9 ly',
    color: SF_COLORS.CAPELLA,
    spin: 0.25,
  },
  {
    id: 'canopus',
    name: 'Canopus',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 45,
    pos: gpos(261.21, -25.3, 310),
    dist: '310 ly',
    color: SF_COLORS.CANOPUS,
    spin: 0.2,
  },
  {
    id: 'polaris',
    name: 'Polaris',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 35,
    pos: gpos(123.28, 26.46, 447),
    dist: '447 ly',
    color: SF_COLORS.POLARIS,
    spin: 0.2,
  },
  {
    id: 'antares',
    name: 'Antares',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 75,
    pos: gpos(351.95, 15.06, 550),
    dist: '550 ly',
    color: SF_COLORS.ANTARES,
    spin: 0.08,
  },
  {
    id: 'rigel',
    name: 'Rigel',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 50,
    pos: gpos(209.24, -25.25, 863),
    dist: '863 ly',
    color: SF_COLORS.RIGEL,
    spin: 0.15,
  },
  {
    id: 'deneb',
    name: 'Deneb',
    kind: SF_KINDS.STAR,
    group: SF_GROUPS.MILKY_WAY,
    radius: 60,
    pos: gpos(84.28, 1.99, 2615),
    dist: '2 615 ly',
    color: SF_COLORS.DENEB,
    spin: 0.15,
  },
  {
    id: 'kepler-452',
    name: 'Kepler-452',
    kind: SF_KINDS.SYSTEM,
    group: SF_GROUPS.MILKY_WAY,
    radius: 12,
    pos: gpos(79.41, 11.72, 1800),
    dist: '1 800 ly',
    color: SF_COLORS.KEPLER_STAR,
    satellites: [{ radius: 1.2, orbit: 22, speed: 0.8, color: SF_COLORS.KEPLER_PLANET }],
  },
]
