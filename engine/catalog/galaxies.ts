/**
 * @file engine/catalog/galaxies.ts
 * @description The three grand spirals — the Milky Way volumetric
 * particle disc plus Andromeda and Triangulum photographic bodies at
 * their real directions. Split out of catalog.ts.
 */

import { SF_COLORS, SF_SCALE, SF_SPIRAL } from '@core/tokens/starfield/params.js'
import { SF_TEXTURES } from '@core/tokens/starfield/textures.js'
import { SF_GROUPS, SF_KINDS } from '@core/tokens/starfield/kinds.js'
import type { SFBodyDef } from '../types.js'
import { gpos, M31_POS, MW_CENTER, MW_RADIUS } from './geo.js'

/**
 * The three grand spirals — the Milky Way renders as a seeded volumetric
 * particle galaxy (never a face-on photo: we are inside it), centered at
 * MW_CENTER so the Sun lands on its true 0.51 galactocentric ring with a
 * heliocentric exclusion bubble keeping disc particles off the solar
 * system. Sagittarius A* parents onto the disc center so its accretion
 * composite inherits the galactic tilt. Andromeda and Triangulum land at
 * their true (l, b) directions on Local-Group-tier distances (~11.9k /
 * ~12.8k units).
 */
export const GALAXIES: SFBodyDef[] = [
  {
    id: 'milky-way',
    name: 'Milky Way',
    kind: SF_KINDS.GALAXY,
    group: SF_GROUPS.GALAXIES,
    radius: MW_RADIUS,
    pos: MW_CENTER,
    dist: '26 673 ly',
    // Volumetric disc — 400k seeded stars + a spherical stellar halo and a
    // thickened disc so the galaxy reads as a 3-D object from inside;
    // the bubble keeps particles out of the solar system's volume.
    spiralDisc: {
      count: 400000,
      volumetric: true,
      thick: 1.8,
      halo: 0.05,
      bubble: SF_SPIRAL.SUN_BUBBLE,
    },
    color: SF_COLORS.MILKY_WAY,
    tilt: SF_SCALE.MW_TILT,
    // Whole-disc spin — the rider carries the solar system around the
    // galactic centre at this rate; the inner-disc rotor adds
    // ROTOR_DIFF× on top for differential rotation. 0.02·SPIN_SPEED
    // revolves the core on a ~44-minute lap — a slow geological drift
    // the frame barely reveals, matching the real ~230-Myr galactic
    // year rather than a spinning plate.
    spin: 0.02,
  },
  {
    // Catalog-ordered AFTER milky-way so the parent anchor resolves at
    // build time; [0,0,0] in the disc's local frame is the exact galactic
    // center — the composite inherits the disc tilt, so the accretion
    // plane lies on the galactic plane and the jets point at the poles.
    id: 'sagittarius-a',
    name: 'Sagittarius A*',
    kind: SF_KINDS.BLACK_HOLE,
    group: SF_GROUPS.MILKY_WAY,
    radius: 12,
    pos: [0, 0, 0],
    parent: 'milky-way',
    dist: '26 673 ly',
    color: SF_COLORS.SAGITTARIUS_A,
    jets: true,
    spin: 0.6,
    pulse: { period: 2.4, amp: 0.05 },
  },
  {
    id: 'andromeda',
    name: 'Andromeda Galaxy',
    kind: SF_KINDS.GALAXY,
    group: SF_GROUPS.GALAXIES,
    radius: 1100,
    pos: M31_POS,
    dist: '2.537 Mly',
    spiralDisc: { count: 800000, halo: 0.08 },
    texture: SF_TEXTURES.GALAXY_ANDROMEDA,
    color: SF_COLORS.ANDROMEDA,
    tilt: 0.55,
    spin: 0.015,
  },
  {
    id: 'triangulum',
    name: 'Triangulum Galaxy',
    kind: SF_KINDS.GALAXY,
    group: SF_GROUPS.GALAXIES,
    radius: 300,
    pos: gpos(133.61, -31.33, 2730000),
    dist: '2.73 Mly',
    spiralDisc: { count: 120000 },
    texture: SF_TEXTURES.GALAXY_TRIANGULUM,
    color: SF_COLORS.TRIANGULUM,
    tilt: 0.8,
  },
]
