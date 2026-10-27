/**
 * Star Field module barrel.
 *
 * The `star-field` experiment module provides the
 * three.js star-chart scene and the <view-star-field> component surface.
 * Self-contained: imports resolve through the core module, never website or CMS.
 * Re-export-only file.
 */
/* istanbul ignore file */

export { StarField } from './StarField.js'
export { StarFieldEngine } from './starfield-engine.js'
export { SF_CATALOG, SF_GROUP_ORDER, sfCatalogByGroup } from './engine/catalog.js'
export type { SFBodyDef, SFDossier } from './engine/types.js'
