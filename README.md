# luiskr.com V3 — star-field

Three.js star-field exploration experiment — the Solar System plus notable
Milky Way, Local-Group and cosmic-hierarchy objects (Alpha/Proxima Centauri,
Sirius, Vega, Betelgeuse, TRAPPIST-1, Sagittarius A*, the asteroid and
Kuiper belts, Orion/Eagle/Crab/Helix nebulae, the Milky Way, Andromeda,
Triangulum, the Local Group volume, superclusters and the observable-universe
rim — 111 catalog bodies), each backed by a lazily-loaded JSON dossier of
facts and deep-history notes from NASA/JPL, ESA, ESO and the IAU.

Route: `/star-field-experiment` (canonical) with per-locale slugs for all
16 supported locales; reachable from the hamburger menu.

Submodule of [luiskr.com-V3](https://github.com/LuisKrotz/luiskr.com-V3).
Install deps from the superproject (`yarn install` at the root), then run
`yarn dev` / `yarn test` / `yarn build` in this folder — see `package.json`
scripts.

## Layout

| Path                    | Role                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `StarField.tsx`         | Custom element facade — loader, drawer, dossier panel, keydown        |
| `starfield-engine.ts`   | `StarFieldEngine` — state bag + public API (init/select/screenshot)   |
| `star/`                 | Component layer: `boot`, `render`, `i18n`, `dossier`                  |
| `engine/`               | three.js layer: `bootstrap`, `renderer-setup`, `scene`,               |
|                         | `bodies-scene`, `spiral`, `star-cloud`, `registry`, `frame`, `fly`,   |
|                         | `picking`, `screenshot`, `state`, `catalog`, `scale`, `materials`,    |
|                         | `types`                                                               |
| `engine/bodies/`        | Body renderers: `deep-sky` (photo billboards), `mask` (edge feather), |
|                         | `belt` (asteroid/Kuiper annuli), `black-hole` (Sgr A* composite),     |
|                         | `structures` (hierarchy shells + member speckles)                     |
| `public/textures/`      | Planet maps + skybox + nebula/galaxy photography                      |
| `public/data/<locale>/` | Per-locale dossiers — fetched on approach/selection, cached           |
| `public/data/index/`    | 139k-record registry — manifest + packed shards for search/browse     |
| `public/media/`         | Self-hosted NASA imagery/audio/video per body                         |
| `tests/`                | Jest suites + `tests/coverage/starfield/**` tails — 100% gate         |

## Data model

`engine/catalog.ts` is the sole body catalog (positions, radii, orbits,
material recipes, groups). `public/data/<locale>/<id>.json` ships the
display dossier (`name`, `kind`, `tagline`, `facts[]`, `history`,
`source`, `media`, `meta` provenance signature) — one file per body per
locale so the viewer only downloads facts when the camera approaches or
a body is selected, falling back to English when a locale file is
absent. `star/dossier.ts` dedupes in-flight and resolved fetches in one
shared `locale:id` cache.

`public/data/index/` holds the deep-field registry — a `manifest.json`
plus packed `star-*`/`exoplanet-*`/`dso-*` shards (~139k records).
Records stream lazily for navigator search and per-kind "load more";
selecting a registry id synthesizes a dossier from the record fields
instead of fetching JSON.

`engine/scale.ts` owns the chart scale: a continuous three-tier
compression (galactic → Local Group → cosmic) that keeps close bodies at
honest ratios while clamping the observable universe inside the scene.
`catalog.ts` places every deep-sky body on its real galactic (l, b)
direction through `sfGalacticPos`; solar-neighborhood stars ride a
legibility band (`nbr`) so Proxima doesn't collapse into the Sun.

## Rendering

The engine runs on `WebGPURenderer` — all custom materials are TSL node
materials (`three/tsl` + `MeshBasicNodeMaterial`), injected through
`SFNodeDeps` from `bootstrap.ts`. Classic GLSL `ShaderMaterial` is not
compatible with the node pipeline.

- Solar bodies: texture-mapped spheres (`MeshStandardMaterial` under the
  sun rig) with per-body detail layers — Earth carries day, normal,
  night-emissive, specular, cloud-deck and elevation-bump maps; stars and
  the Sun add an additive halo sprite.
- Luminous bodies (stars, the Sun, systems): a fresnel-limb node material
  blooms at the silhouette and dissolves into the halo instead of
  cutting a hard disc.
- Saturn's ring: `2k_saturn_ring_alpha.png` is a radial strip, so the
  ring geometry's planar UVs are remapped radius→U (`bodies-scene.ts`)
  to preserve the C/B/A bands and Cassini gap.
- Nebulae/clusters: photographic billboards with a circular feather
  mask (`engine/bodies/mask.ts`) so square frames dissolve into space;
  procedural radial glows stand in when a photo is missing.
- Galaxies: photo-textured tilted discs plus a sparkle-particle overlay
  and additive core glow (`engine/spiral.ts`); the seeded procedural
  particle disc remains as the fallback for unphotographed bodies.
- Sagittarius A*: layered composite (`engine/bodies/black-hole.ts`) —
  black event horizon, thin photon ring, dust-lane accretion disc (TSL),
  orbiting plasma swirl, faint bipolar jets and a warm lensing-glow
  sprite.
- Asteroid + Kuiper belts (`engine/bodies/belt.ts`): seeded particle
  annuli with Kirkwood gap lanes (asteroid belt) or a smooth classical
  disc (Kuiper), vertical puff and per-particle albedo jitter;
  raycast-disabled so pebbles never eat pointer hits.
- Hierarchy structures (`engine/bodies/structures.ts`): fresnel-rim
  boundary shells (Local Group volume, superclusters, universe rim) with
  seeded member-galaxy speckle clouds; non-pickable by contract.
- Orbit guides fade as they turn edge-on (`frame.ts` `updateRings`) so a
  guide seen side-on dissolves instead of cutting a hard line.
- All color textures are tagged `SRGBColorSpace` in `bootstrap.ts`.

## Accessibility

One real `<button>` per body in the navigator drawer (full keyboard
coverage), Escape dismisses the dossier panel first then the drawer,
hover/selection announce through an `aria-live` region, and
`prefers-reduced-motion` pauses the render loop. Pointer events unify
mouse/touch/pen.

## Assets

- Planet/moon/sun maps + Saturn ring: Solar System Scope texture set,
  [CC-BY 4.0](https://www.solarsystemscope.com/textures/).
- Milky Way skybox: 8k equirect star panorama (same set).
- Earth elevation bump map: NASA Visible Earth topography + bathymetry
  (public domain, via Wikimedia Commons `Earth_dry_elevation.png`).
- Nebula/cluster/galaxy photography: NASA/ESA/ESO (Hubble/JWST/Chandra)
  and ESA Gaia mission imagery — public domain / CC-BY, hotlinked into
  `public/textures/` at download time.
- Face-on Milky Way map: ESA/Gaia all-sky artist impression.
- Dossier media: self-hosted NASA/JPL imagery, audio and video under
  `public/media/<body>/`.
- Dossier facts/history paraphrased from NASA/JPL Solar System
  Exploration, ESA, ESO and IAU publications — each JSON names its source
  and signs an acquisition/translation date in `meta`.

License: [MPL-2.0](https://github.com/LuisKrotz/luiskr.com-V3/blob/development/LICENSE)
