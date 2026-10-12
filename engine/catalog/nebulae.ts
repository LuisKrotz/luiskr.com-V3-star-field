/**
 * @file engine/catalog/nebulae.ts
 * @description Nebulae + globular clusters — billboard sprites at real
 * galactic (l, b, distance) through `gpos`. Split out of catalog.ts.
 */

import { SF_COLORS } from '@core/tokens/starfield/params.js'
import { SF_TEXTURES } from '@core/tokens/starfield/textures.js'
import { SF_GROUPS, SF_KINDS } from '@core/tokens/starfield/kinds.js'
import type { SFBodyDef } from '../types.js'
import { gpos } from './geo.js'

/**
 * Nebulae + globular clusters — billboard sprites at real galactic (l,
 * b, distance) through `gpos`: every member lands at its true compressed
 * radius, from the 655-ly Helix (~6.6 units) out to the Tarantula in the
 * LMC (~1 610 units) and the halo globulars.
 */
export const NEBULAE: SFBodyDef[] = [
  {
    id: 'orion-nebula',
    name: 'Orion Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.12,
    pos: gpos(209.01, -19.38, 1344),
    dist: '1 344 ly',
    texture: SF_TEXTURES.NEBULA_ORION,
    color: SF_COLORS.ORION_NEBULA,
  },
  {
    id: 'eagle-nebula',
    name: 'Eagle Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.35,
    pos: gpos(16.97, 0.8, 7000),
    dist: '7 000 ly',
    texture: SF_TEXTURES.NEBULA_EAGLE,
    color: SF_COLORS.EAGLE_NEBULA,
  },
  {
    id: 'crab-nebula',
    name: 'Crab Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.055,
    pos: gpos(184.56, -5.78, 6500),
    dist: '6 500 ly',
    texture: SF_TEXTURES.NEBULA_CRAB,
    color: SF_COLORS.CRAB_NEBULA,
    pulse: { period: 1.6, amp: 0.08 },
  },
  {
    id: 'helix-nebula',
    name: 'Helix Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.03,
    pos: gpos(36.07, -57.17, 655),
    dist: '655 ly',
    texture: SF_TEXTURES.NEBULA_HELIX,
    color: SF_COLORS.HELIX_NEBULA,
  },
  {
    id: 'pleiades',
    name: 'Pleiades',
    kind: SF_KINDS.CLUSTER,
    group: SF_GROUPS.NEBULAE,
    radius: 0.2,
    pos: gpos(166.64, -23.46, 444),
    dist: '444 ly',
    texture: SF_TEXTURES.CLUSTER_PLEIADES,
    color: SF_COLORS.PLEIADES,
  },
  {
    id: 'ring-nebula',
    name: 'Ring Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.008,
    pos: gpos(63.13, 13.81, 2566),
    dist: '2 566 ly',
    texture: SF_TEXTURES.NEBULA_RING,
    color: SF_COLORS.RING_NEBULA,
  },
  {
    id: 'horsehead',
    name: 'Horsehead Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.02,
    pos: gpos(206.86, -16.7, 1375),
    dist: '1 375 ly',
    texture: SF_TEXTURES.NEBULA_HORSEHEAD,
    color: SF_COLORS.HORSEHEAD,
  },
  {
    id: 'lagoon',
    name: 'Lagoon Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 0.55,
    pos: gpos(5.96, -1.23, 4100),
    dist: '4 100 ly',
    texture: SF_TEXTURES.NEBULA_LAGOON,
    color: SF_COLORS.LAGOON,
  },
  {
    id: 'carina',
    name: 'Carina Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 2.3,
    pos: gpos(287.6, -0.69, 8500),
    dist: '8 500 ly',
    texture: SF_TEXTURES.NEBULA_CARINA,
    color: SF_COLORS.CARINA,
  },
  {
    id: 'tarantula',
    name: 'Tarantula Nebula',
    kind: SF_KINDS.NEBULA,
    group: SF_GROUPS.NEBULAE,
    radius: 3.25,
    pos: gpos(279.46, -31.67, 161000),
    dist: '161 000 ly',
    texture: SF_TEXTURES.NEBULA_TARANTULA,
    color: SF_COLORS.TARANTULA,
  },
  {
    id: 'omega-centauri',
    name: 'Omega Centauri',
    kind: SF_KINDS.CLUSTER,
    group: SF_GROUPS.NEBULAE,
    radius: 0.86,
    pos: gpos(309.1, 15.0, 17090),
    dist: '17 090 ly',
    texture: SF_TEXTURES.CLUSTER_OMEGA,
    color: SF_COLORS.OMEGA_CEN,
  },
  {
    id: '47-tucanae',
    name: '47 Tucanae',
    kind: SF_KINDS.CLUSTER,
    group: SF_GROUPS.NEBULAE,
    radius: 0.6,
    pos: gpos(305.89, -44.89, 14500),
    dist: '14 500 ly',
    color: SF_COLORS.OMEGA_CEN,
  },
  {
    id: 'm13-hercules',
    name: 'Great Hercules Cluster',
    kind: SF_KINDS.CLUSTER,
    group: SF_GROUPS.NEBULAE,
    radius: 0.73,
    pos: gpos(59.01, 40.91, 22200),
    dist: '22 200 ly',
    color: SF_COLORS.PLEIADES,
  },
]
