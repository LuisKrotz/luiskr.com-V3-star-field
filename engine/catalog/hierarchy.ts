/**
 * @file engine/catalog/hierarchy.ts
 * @description Cosmic-hierarchy boundary structures — translucent
 * shells + member speckle clouds marking the chart's nesting scales.
 * Navigator/fly-to landmarks only. Split out of catalog.ts.
 */

import { SF_COLORS, SF_SCALE } from '@core/tokens/starfield/params.js'
import { SF_GROUPS, SF_KINDS } from '@core/tokens/starfield/kinds.js'
import type { SFBodyDef } from '../types.js'
import { gpos, M31_POS, MW_CENTER } from './geo.js'

/**
 * Cosmic-hierarchy boundary structures — translucent shells + member
 * speckle clouds marking the chart's nesting scales: the Local Group
 * volume enclosing every dwarf, the named superclusters at their true
 * directions on the cosmic tier, the Laniakea basin that contains them
 * all, and the observable-universe rim clamped onto the far-field
 * boundary. Never raycast — they are navigator/fly-to landmarks only.
 */
export const HIERARCHY: SFBodyDef[] = [
  {
    // The stellar neighbourhood marks itself — a member speckle cloud
    // at the honest ~2 000-ly extent, NO boundary shell: a fresnel
    // bubble at chart scale reads as a fake sphere wall (the artifact
    // this chart keeps getting called out on).
    id: 'interstellar-neighborhood',
    name: 'Interstellar Neighborhood',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 45,
    pos: [0, 0, 0],
    dist: '~2 000 ly',
    structure: { radius: 45, speckles: 240, shell: false },
    color: SF_COLORS.SHELL_LOCAL,
  },
  {
    // The Local Group volume centers on the Milky Way ↔ Andromeda
    // midpoint so the shell genuinely encloses both gravitational
    // subgroups; the radius reaches past the farthest member
    // (Sextans A at ~4.4 Mly ≈ 14.3k units).
    id: 'local-group',
    name: 'Local Group',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 17000,
    pos: [
      (MW_CENTER[0] + M31_POS[0]) / 2,
      (MW_CENTER[1] + M31_POS[1]) / 2,
      (MW_CENTER[2] + M31_POS[2]) / 2,
    ],
    dist: '~10 Mly wide',
    structure: { radius: 17000, speckles: 400 },
    color: SF_COLORS.SHELL_LOCAL,
  },
  {
    id: 'virgo-supercluster',
    name: 'Virgo Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 2600,
    pos: gpos(283.8, 74.49, 53800000),
    dist: '53.8 Mly',
    structure: { radius: 2600, speckles: 1400 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'hydra-centaurus-supercluster',
    name: 'Hydra–Centaurus Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 2800,
    pos: gpos(289, 22, 175000000),
    dist: '175 Mly',
    structure: { radius: 2800, speckles: 1200 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'coma-supercluster',
    name: 'Coma Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 3000,
    pos: gpos(57.6, 88.0, 321000000),
    dist: '321 Mly',
    structure: { radius: 3000, speckles: 1200 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'perseus-pisces-supercluster',
    name: 'Perseus–Pisces Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 2800,
    pos: gpos(150.6, -13.3, 250000000),
    dist: '250 Mly',
    structure: { radius: 2800, speckles: 1200 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'shapley-supercluster',
    name: 'Shapley Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 3800,
    pos: gpos(312.3, 30.9, 650000000),
    dist: '650 Mly',
    structure: { radius: 3800, speckles: 1400 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'horologium-supercluster',
    name: 'Horologium–Reticulum Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 3400,
    pos: gpos(255, -60, 700000000),
    dist: '700 Mly',
    structure: { radius: 3400, speckles: 1200 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'laniakea',
    name: 'Laniakea Supercluster',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: 34500,
    pos: gpos(325.3, -7.2, 220000000),
    dist: '~520 Mly wide',
    structure: { radius: 34500, speckles: 1400 },
    color: SF_COLORS.SHELL_SUPER,
  },
  {
    id: 'observable-universe',
    name: 'Observable Universe',
    kind: SF_KINDS.STRUCTURE,
    group: SF_GROUPS.HIERARCHY,
    radius: SF_SCALE.COSMIC_CLAMP,
    pos: [0, 0, 0],
    dist: '46.5 Gly',
    structure: { radius: SF_SCALE.COSMIC_CLAMP, speckles: 1400 },
    color: SF_COLORS.SHELL_UNIVERSE,
  },
]
