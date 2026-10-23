// The published national dataset (server only). The build script writes each
// version to storage under waterways/published/{version}/; manifest.json in
// git names the live one, so merging the PR that changes it publishes, and
// reverting it rolls back. Loaded once per server instance and kept in memory.
// See docs/features/waterways-uk-ireland.md.
import { gunzipSync } from 'zlib'
import { getObject, usesLocalStorage } from '@paddlesnitch/core/storage'
import manifestJson from '../data/manifest.json'
import { readNdjsonGz } from './ndjson'
import type { Place } from './places'
import type { OfficialTides } from './tide'
import { osmPortages, portagesAt, type PublicPortage } from './portage'
import { listPublicPortages } from './portage-store'
import { planDemand, planLines } from './plan-store'
import { waterwayCoverage, type WaterwayCoverage } from './waterway-coverage'
import type { Feature, LatLng, NetLink, OsmElement, RegionDataset } from './types'

export type Manifest = {
  version: string | null
  builtAt?: string
  counts?: Record<string, number>
  sources?: Record<string, number>
}

export const manifest = manifestJson as Manifest

/** What the server keeps in memory. `features` is every source's features plus
 *  the OSM lock chambers that fill gaps (published apart, as osm-features.json).
 *  The OSM points layer (osm.json) isn't needed to route, so it isn't loaded;
 *  its portage paths are (osm-portages.json), as landings. */
export type NationalDataset = {
  version: string
  links: NetLink[]
  features: Feature[]
  places: Place[]
  portages: PublicPortage[]      // OpenStreetMap portage paths (ODbL), beside paddlers' contributions
}

let coverage: { ds: NationalDataset; portages: PublicPortage[]; lines: LatLng[][]; rows: WaterwayCoverage[] } | null = null

/** Coverage by waterway for the live dataset and paddlers' contributions:
 *  worked out on first ask (about half a second nationally) and kept until
 *  either changes, so nothing extra is published. */
export async function loadCoverage(): Promise<{ version: string; rows: WaterwayCoverage[]; ds: NationalDataset }> {
  const [ds, portages, lines] = await Promise.all([loadNational(), listPublicPortages(), planLines()])
  if (coverage?.ds !== ds || coverage.portages !== portages || coverage.lines !== lines) {
    const visible = [...portages.filter(p => !p.hidden), ...ds.portages]
    coverage = { ds, portages, lines, rows: waterwayCoverage(ds.links, ds.features, f => portagesAt(f, visible).length > 0, lines) }
  }
  return { version: ds.version, rows: coverage.rows, ds }
}

export type NeededLock = { id: string; name?: string; kind: Feature['kind']; at: [number, number]; plans: number }

/** Locks and portages with no paddler's portage details yet, most-planned
 *  first: where an hour of someone's knowledge helps most people. */
export async function loadNeeded(limit = 50): Promise<NeededLock[]> {
  const [ds, portages, demand] = await Promise.all([loadNational(), listPublicPortages(), planDemand()])
  const visible = [...portages.filter(p => !p.hidden), ...ds.portages]
  const out: NeededLock[] = []
  for (const f of ds.features) {
    const plans = demand.get(f.id) ?? 0
    if (!plans || (f.kind !== 'lock' && f.kind !== 'portage') || f.portage?.side || portagesAt(f, visible).length) continue
    out.push({ id: f.id, name: f.name, kind: f.kind, at: f.at, plans })
  }
  return out.sort((a, b) => b.plans - a.plans || (a.name ?? '').localeCompare(b.name ?? '')).slice(0, limit)
}

export const publishedKey = (version: string, name: string) => `waterways/published/${version}/${name}.json.gz`
export const publishedNdjsonKey = (version: string, name: string) => `waterways/published/${version}/${name}.ndjson.gz`

/** The network, streamed from its NDJSON copy when the version has one (from
 *  2026-10-22), else parsed from the JSON (older versions). */
export async function readNetwork(get: (key: string) => Promise<Buffer | null>, version: string): Promise<NetLink[] | null> {
  const nd = await get(publishedNdjsonKey(version, 'network')).catch(() => null)
  if (nd) return readNdjsonGz<NetLink>(nd)
  const buf = await get(publishedKey(version, 'network')).catch(() => null)
  return buf ? (JSON.parse(gunzipSync(buf).toString('utf8')) as NetLink[]) : null
}

let official: { version: string; value: Promise<OfficialTides | null> } | null = null
/** Rijkswaterstaat's predicted Dutch high and low waters published with the
 *  live version (`tides-nl`), or null when that version has none. */
export function loadOfficialTides(): Promise<OfficialTides | null> {
  const v = manifest.version
  if (!v) return Promise.resolve(null)
  if (official?.version !== v) {
    const value = getObject(publishedKey(v, 'tides-nl'))
      .then(buf => (buf ? JSON.parse(gunzipSync(buf).toString('utf8')) as OfficialTides : null))
      .catch(() => null)
    official = { version: v, value }
  }
  return official.value
}

let loading: Promise<NationalDataset> | null = null

/** The live dataset. Before the first publish, and in local dev and tests when
 *  the published version isn't in local storage, the committed
 *  Devizes–Westminster fixture stands in. */
export function loadNational(): Promise<NationalDataset> {
  loading ??= load().catch(e => { loading = null; throw e })
  return loading
}

async function load(): Promise<NationalDataset> {
  const v = manifest.version
  const ds = v ? await readDataset(getObject, v) : null
  if (!ds) {
    // Nothing published yet (no version) runs on the fixture everywhere; a named
    // version missing from S3 is a broken deploy and must say so.
    if (v && !usesLocalStorage()) throw new Error(`waterways: published version ${v} not found`)
    return fixture()
  }
  return ds
}

/** A published version, every file fetched at once: on a cold start the
 *  downloads overlap rather than wait for the 34 MB network first. Null when
 *  the version has no network. */
export async function readDataset(get: (key: string) => Promise<Buffer | null>, v: string): Promise<NationalDataset | null> {
  const read = async <T>(name: string): Promise<T | null> => {
    const buf = await get(publishedKey(v, name))
    return buf ? (JSON.parse(gunzipSync(buf).toString('utf8')) as T) : null
  }
  const rest = Promise.all([
    read<Feature[]>('features'), read<Feature[]>('osm-features'), read<Feature[]>('sa-features'), read<Place[]>('places'), read<OsmElement[]>('osm-portages'),
  ])
  rest.catch(() => {})   // no network: the caller falls back, and these don't matter
  const links = await readNetwork(get, v)
  if (!links) return null
  const [features, osmFeatures, saFeatures, places, portages] = await rest
  // Routing sees one list; the files stay apart (licence layers: OSM is ODbL, sa-features CC BY-SA).
  return { version: v, links, features: [...(features ?? []), ...(osmFeatures ?? []), ...(saFeatures ?? [])], places: places ?? [], portages: osmPortages(portages ?? []) }
}

async function fixture(): Promise<NationalDataset> {
  const { buildPlaces } = await import('./places')
  const dw = (await import('../data/dw.json')).default as unknown as RegionDataset
  return { version: 'dw-fixture', links: dw.links, features: dw.features, places: buildPlaces([], dw.features, dw.links), portages: [] }
}
