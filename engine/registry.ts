/**
 * @file engine/registry.ts
 * @description Deep-catalog registry — the addressable index over the
 * 139,563 real catalogued objects packed into `public/data/index/`:
 * 119,626 HYG/Hipparcos stars, 5,974 NASA Exoplanet Archive planets and
 * 13,963 OpenNGC deep-sky objects. Records ship as 1,000-entry JSON
 * shards fetched strictly on demand — the manifest loads once when the
 * directory opens, and each body id (`star-000042`, `exoplanet-001234`,
 * `dso-009001`) decodes to `shard = rank ÷ 1000`, `slot = rank mod
 * 1000` by pure arithmetic, so a deep link resolves its record with a
 * single ~100 KB fetch and no lookup table.
 */
import { SF_BODY_IDS, SF_STAR_CLOUD } from '@core/tokens/starfield/params.js'
import { SF_DATA_BASE } from '@core/tokens/starfield/textures.js'
import { SF_REGISTRY_INDEX_DIR, SF_REGISTRY_MANIFEST } from '@core/tokens/starfield/registry.js'
import { anchorWorldPos } from './frame/camera.js'
import { sfGalacticVec } from './scale.js'
import type { SFState } from './types.js'
import { devError } from '@core/devlog.js'

/** Registry id grammar — `<kind>-<zero-padded global rank>`. */
const REGISTRY_ID_RE = /^(star|exoplanet|dso)-(\d{6})$/

/**
 * Manifest shape for `index/manifest.json` — per-kind record counts
 * and the shard file list so the directory can show totals before any
 * shard has been fetched.
 */
export interface SFRegistryManifest {
  /** Total records across all kinds (139,563). */
  total: number
  /** Records per shard file (1,000). */
  shardSize: number
  /** Per-kind stats: count + ordered shard filenames. */
  kinds: Record<string, { count: number; shards: string[] }>
}

/**
 * One catalogued record inside a shard — field keys are short on
 * purpose (the 14 MB index would double with long names): `n` display
 * name/designation, `m` apparent magnitude, `d` heliocentric distance
 * in light-years, `s` spectral class, `c` constellation/catalog name,
 * `h` host star (exoplanets), `t` object type code (DSOs), `r`
 * redshift, `y2` discovery year (exoplanets), `x/y/z` heliocentric
 * light-years, `i` registry id.
 */
export interface SFRegistryRecord {
  i: string
  n: string
  m?: number | null
  d?: number
  s?: string
  c?: string
  h?: string
  t?: string
  r?: number | null
  y2?: string
  x: number
  y: number
  z: number
}

/** Cached manifest promise — one fetch per session. */
let _manifest: Promise<SFRegistryManifest | null> | null = null

/** Resolved shard cache — `index/<kind>-NNN.json` → parsed records. */
const _shards = new Map<string, Promise<SFRegistryRecord[] | null>>()

/**
 * Type predicate — distinguishes the 139k registry ids from the 66
 * authored catalog slugs so selection/deep-link code can route each
 * path without a lookup table.
 * @param id Candidate body id.
 * @returns True for `star-NNNNNN`/`exoplanet-NNNNNN`/`dso-NNNNNN`.
 */
export function isRegistryId(id: string): boolean {
  return REGISTRY_ID_RE.test(id)
}

/**
 * Splits a registry id into its kind and global rank — the two numbers
 * the shard math needs (`shard = rank ÷ shardSize`, `slot = rank mod
 * shardSize`). Returns null on malformed ids.
 * @param id Registry id (`star-000042`).
 * @returns `{ kind, rank }` or null.
 */
export function parseRegistryId(id: string): { kind: string; rank: number } | null {
  const m = REGISTRY_ID_RE.exec(id)

  return m ? { kind: m[1], rank: parseInt(m[2], 10) } : null
}

/**
 * Fetches the registry manifest once per session — the directory needs
 * it for the per-kind counts and shard lists; selection paths don't
 * (ids self-decode to their shard).
 * @returns The parsed manifest, or null on fetch/parse failure.
 */
export function ensureRegistryManifest(): Promise<SFRegistryManifest | null> {
  if (!_manifest) {
    _manifest = fetch(`${SF_DATA_BASE}/${SF_REGISTRY_INDEX_DIR}/${SF_REGISTRY_MANIFEST}`)
      .then((res) => (res.ok ? (res.json() as Promise<SFRegistryManifest>) : null))
      // Shape-guard: a payload without `kinds` isn't a manifest (a
      // misdirected names/dossier JSON must never poison the session
      // cache — the same null path lets the next caller retry).
      .then((m) =>
        m && typeof m === 'object' && m.kinds && typeof m.kinds === 'object' ? m : null
      )
      .catch((e) => {
        devError('[StarField] registry manifest error:', e)

        return null
      })
      // A null (failed) result is never cached — the next caller
      // retries instead of inheriting a poisoned manifest.
      .then((m) => {
        if (!m) _manifest = null

        return m
      })
  }

  return _manifest
}

/**
 * Fetches (or returns the cached promise for) one 1,000-record shard —
 * shards are the lazy-load unit so browsing the catalogue never pulls
 * the full 14 MB index up front.
 * @param kind Record kind (`star`/`exoplanet`/`dso`).
 * @param shardIx Zero-based shard index.
 * @returns The parsed record array, or null on failure.
 */
export function loadRegistryShard(
  kind: string,
  shardIx: number
): Promise<SFRegistryRecord[] | null> {
  const key = `${kind}-${String(shardIx).padStart(3, '0')}`

  let pending = _shards.get(key)

  if (!pending) {
    pending = fetch(`${SF_DATA_BASE}/${SF_REGISTRY_INDEX_DIR}/${key}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<SFRegistryRecord[]>) : null))
      .catch((e) => {
        devError('[StarField] registry shard error:', key, e)

        return null
      })
      // Same retry-on-null contract as the manifest — a transient
      // failure must not permanently wedge the shard.
      .then((s) => {
        if (!s) _shards.delete(key)

        return s
      })

    _shards.set(key, pending)
  }

  return pending
}

/**
 * Resolves a registry id to its full record — pure shard arithmetic
 * (`shard = rank ÷ 1000`, `slot = rank mod 1000`), one fetch worst
 * case, cache-hit best case. Out-of-range ids resolve null so stale
 * links degrade silently to the overview chart.
 * @param id Registry id (`star-000042`).
 * @returns The record, or null when unknown/unreachable.
 */
export async function loadRegistryRecord(id: string): Promise<SFRegistryRecord | null> {
  const parsed = parseRegistryId(id)

  if (!parsed) return null

  const manifest = await ensureRegistryManifest()

  const kindInfo = manifest?.kinds?.[parsed.kind]

  // A resolved manifest is authoritative: a kind it doesn't declare can
  // never resolve, so bail before touching the network. A null manifest
  // (offline) still falls through — ids self-decode to their shard.
  if (manifest && !kindInfo) return null

  if (kindInfo && parsed.rank >= kindInfo.count) return null

  const shard = await loadRegistryShard(
    parsed.kind,
    Math.floor(parsed.rank / SF_STAR_CLOUD.SHARD_SIZE)
  )

  // Malformed shard payloads (object/error bodies, truncated files) must
  // not crash the lookup — only arrays carry slot-indexed records.
  if (!Array.isArray(shard)) return null

  return shard[parsed.rank % SF_STAR_CLOUD.SHARD_SIZE] ?? null
}

/**
 * Streams registry shards for a kind in order — the directory's
 * incremental "load more" path; yields each parsed shard so callers can
 * append results as they land without holding 120k records at once.
 * @param kind Record kind to stream.
 */
export async function* streamRegistryShards(
  kind: string
): AsyncGenerator<SFRegistryRecord[], void, void> {
  const manifest = await ensureRegistryManifest()

  const files = manifest?.kinds?.[kind]?.shards ?? []

  for (let i = 0; i < files.length; i++) {
    const shard = await loadRegistryShard(kind, i)

    if (!shard) return

    yield shard
  }
}

/**
 * Incremental registry search — pulls shards sequentially and collects
 * records whose display name or catalogue designation contains the
 * query (case-folded), stopping at `limit` matches so a "vega" search
 * resolves in one shard while still scaling to the full catalogue.
 * @param query Substring to match (empty returns nothing).
 * @param limit Match cap (default 200).
 * @returns Matching records in shard order (brightest/alphabetical).
 */
export async function searchRegistry(
  query: string,
  limit = SF_STAR_CLOUD.SEARCH_LIMIT
): Promise<SFRegistryRecord[]> {
  const q = query.trim().toLowerCase()

  if (!q) return []

  const out: SFRegistryRecord[] = []

  for (const kind of SF_STAR_CLOUD.REGISTRY_KINDS) {
    for await (const shard of streamRegistryShards(kind)) {
      for (const rec of shard) {
        if (
          rec.n.toLowerCase().includes(q) ||
          (rec.c && rec.c.toLowerCase().includes(q)) ||
          (rec.h && rec.h.toLowerCase().includes(q))
        ) {
          out.push(rec)

          if (out.length >= limit) return out
        }
      }
    }
  }

  return out
}

/**
 * World-space position of a registry record — delegates to the shared
 * `sfGalacticVec` Cartesian path so fly-to lands exactly on the
 * rendered cloud point: records carry heliocentric galactic xyz, the
 * cloud mounts on the Sun's pivot at the scene origin, and the same
 * three-tier distance compression + disc tilt apply.
 * @param s Engine state (for the Milky Way disc tilt).
 * @param rec The registry record.
 * @returns `{x,y,z}` world position, or null without a scene.
 */
export function registryWorldPos(
  s: SFState,
  rec: SFRegistryRecord
): { x: number; y: number; z: number } | null {
  const mw = s.nodes.get(SF_BODY_IDS.MILKY_WAY)?.def

  if (!mw?.pos) return null

  const [x, y, z] = sfGalacticVec(rec.x, rec.y, rec.z, mw.tilt ?? 0)

  // The cloud mounts on the Sun's pivot — resolve the pivot's live world
  // position and add the record's heliocentric offset so the result is
  // correct whichever anchor the floating origin currently pins (with
  // the Sun pinned it simply lands at the origin).
  const pivot = s.nodes.get(SF_BODY_IDS.SUN)?.pivot

  const base = pivot?.getWorldPosition ? anchorWorldPos(pivot) : { x: 0, y: 0, z: 0 }

  return { x: base.x + x, y: base.y + y, z: base.z + z }
}
