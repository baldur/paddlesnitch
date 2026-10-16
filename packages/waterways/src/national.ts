// The published national dataset (server only). The build script writes each
// version to storage under waterways/published/{version}/; manifest.json in
// git names the live one, so merging the PR that changes it publishes, and
// reverting it rolls back. Loaded once per server instance and kept in memory.
// See docs/features/waterways-uk-ireland.md.
import { gunzipSync } from 'zlib'
import { getObject, usesLocalStorage } from '@paddlesnitch/core/storage'
import manifestJson from '../data/manifest.json'
import type { Place } from './places'
import type { Feature, NetLink, RegionDataset } from './types'

export type Manifest = {
  version: string | null
  builtAt?: string
  counts?: Record<string, number>
  sources?: Record<string, number>
}

export const manifest = manifestJson as Manifest

/** What the server keeps in memory. `features` is every source's features plus
 *  the OSM lock chambers that fill gaps (published apart, as osm-features.json).
 *  The OSM points layer (osm.json) isn't needed to route, so it isn't loaded. */
export type NationalDataset = {
  version: string
  links: NetLink[]
  features: Feature[]
  places: Place[]
}

export const publishedKey = (version: string, name: string) => `waterways/published/${version}/${name}.json.gz`

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
  const read = async <T>(name: string): Promise<T | null> => {
    const buf = v ? await getObject(publishedKey(v, name)) : null
    return buf ? (JSON.parse(gunzipSync(buf).toString('utf8')) as T) : null
  }
  const links = await read<NetLink[]>('network')
  if (!links) {
    // Nothing published yet (no version) runs on the fixture everywhere; a named
    // version missing from S3 is a broken deploy and must say so.
    if (v && !usesLocalStorage()) throw new Error(`waterways: published version ${v} not found`)
    return fixture()
  }
  const [features, osmFeatures, places] = await Promise.all([read<Feature[]>('features'), read<Feature[]>('osm-features'), read<Place[]>('places')])
  // Routing sees one list; the files stay apart (licence layers: OSM is ODbL).
  return { version: v!, links, features: [...(features ?? []), ...(osmFeatures ?? [])], places: places ?? [] }
}

async function fixture(): Promise<NationalDataset> {
  const { buildPlaces } = await import('./places')
  const dw = (await import('../data/dw.json')).default as unknown as RegionDataset
  return { version: 'dw-fixture', links: dw.links, features: dw.features, places: buildPlaces([], dw.features, dw.links) }
}
