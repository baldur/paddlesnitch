// Fetching live conditions (server only): whole national lists, cached per
// server instance, so a route never sends its whereabouts anywhere and a busy
// day doesn't hammer anyone. Station lists keep a day; readings 15 minutes;
// the Thames boards half an hour (they change once a day, by 11am).
// A source that fails is named in `unavailable` and shown as unknown.
import type { LatLng, Feature } from './types'
import {
  eaGauges, gaugesAlong, gaugeUrl, opwGauges, parseThamesConditions, rwsGauges, rwsLatest, sepaGauges, stateOf, thamesReachesOnRoute, waterinfoGauges, pegelonlineGauges,
  THAMES_CONDITIONS_PAGE, THAMES_CONDITIONS_URL, type Gauge, type GaugeReading, type ThamesReach,
} from './live'

const EA = 'https://environment.data.gov.uk/flood-monitoring'
const SEPA = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&format=json'
const OPW_LATEST = 'https://waterlevel.ie/geojson/latest/'
const RWS = 'https://ddapi20-waterwebservices.rijkswaterstaat.nl'
const WATERINFO = 'https://download.waterinfo.be/tsmdownload/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=1&format=json&request=getTimeseriesValueLayer&timeseriesgroup_id=192780&metadata=true'
const PEGELONLINE = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true'
const UA = 'paddlesnitch-river-planner (+https://paddlesnitch.com/plan)'
const MIN = 60_000

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json() as Promise<T>
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json() as Promise<T>
}

const resets: (() => void)[] = []

/** Tests stub the network per case; the caches mustn't outlive that. */
export function clearLiveCaches() { for (const r of resets) r(); eaTypical.clear() }

/** A value fetched at most every `ttl`; a failure isn't cached. */
function cached<T>(ttl: number, load: () => Promise<T>): () => Promise<T> {
  let hit: { at: number; value: Promise<T> } | null = null
  resets.push(() => { hit = null })
  return () => {
    if (!hit || Date.now() - hit.at > ttl) {
      const value = load()
      hit = { at: Date.now(), value }
      value.catch(() => { hit = null })
    }
    return hit.value
  }
}

const eaStations = cached(24 * 60 * MIN, async () =>
  eaGauges((await getJson<{ items: unknown[] }>(`${EA}/id/stations?parameter=level&_limit=10000`)).items))
const eaLatest = cached(15 * MIN, async () => {
  const items = (await getJson<{ items: { measure: string; value: number; dateTime: string }[] }>(`${EA}/data/readings?latest&parameter=level`)).items
  return new Map(items.map(r => [r.measure, r]))
})
const eaTypical = new Map<string, { at: number; value: Promise<{ low: number; high: number } | undefined> }>()
function eaTypicalRange(id: string) {
  const hit = eaTypical.get(id)
  if (hit && Date.now() - hit.at < 24 * 60 * MIN) return hit.value
  const value = getJson<{ items: { stageScale?: { typicalRangeLow?: number; typicalRangeHigh?: number } } }>(`${EA}/id/stations/${encodeURIComponent(id)}`)
    .then(d => {
      const s = d.items.stageScale
      return s && typeof s.typicalRangeLow === 'number' && typeof s.typicalRangeHigh === 'number' ? { low: s.typicalRangeLow, high: s.typicalRangeHigh } : undefined
    })
    .catch(() => undefined)
  eaTypical.set(id, { at: Date.now(), value })
  return value
}

const sepaStations = cached(24 * 60 * MIN, async () =>
  sepaGauges(await getJson<unknown[][]>(`${SEPA}&request=getTimeseriesList&parametertype_name=S&ts_name=15minute&returnfields=ts_id,station_name,station_latitude,station_longitude`)))
async function sepaValues(ids: string[]): Promise<Map<string, { value: number; at: string }>> {
  if (!ids.length) return new Map()
  const rows = await getJson<{ ts_id: string; data: [string, number][] }[]>(`${SEPA}&request=getTimeseriesValues&period=PT3H&returnfields=Timestamp,Value&ts_id=${ids.join(',')}`)
  return new Map(rows.flatMap(r => { const last = r.data.at(-1); return last ? [[r.ts_id, { at: last[0], value: last[1] }] as const] : [] }))
}

const opw = cached(15 * MIN, async () => opwGauges(await getJson<{ features: unknown[] }>(OPW_LATEST)))

/** Every Flemish station's latest level in one call (~350 KB): no route is sent. */
const flanders = cached(15 * MIN, async () => waterinfoGauges(await getJson<unknown[]>(WATERINFO), Date.now()))

/** Every German federal gauge's current level and state in one call (~750 KB): no route is sent. */
const germany = cached(15 * MIN, async () => pegelonlineGauges(await getJson<unknown[]>(PEGELONLINE), Date.now()))

const rwsStations = cached(24 * 60 * MIN, async () =>
  rwsGauges(await postJson(`${RWS}/METADATASERVICES/OphalenCatalogus`, { CatalogusFilter: { Grootheden: true, Eenheden: true, Compartimenten: true } })))
/** Every Dutch station's latest level in one call (~4 MB, ~2 s), so no route is
 *  ever sent; only stations with a fresh reading are kept as gauges. */
const rwsNow = cached(15 * MIN, async () => {
  const stations = await rwsStations()
  const body = await postJson<{ WaarnemingenLijst?: unknown[] }>(`${RWS}/ONLINEWAARNEMINGENSERVICES/OphalenLaatsteWaarnemingen`, {
    LocatieLijst: stations.map(g => ({ Code: g.id })),
    AquoPlusWaarnemingMetadataLijst: [{ AquoMetadata: { Compartiment: { Code: 'OW' }, Grootheid: { Code: 'WATHTE' } } }],
  })
  const latest = rwsLatest(body, Date.now())
  return { gauges: stations.filter(g => latest.has(g.id)), latest }
})

const thames = cached(30 * MIN, async () => parseThamesConditions((await getJson<{ details: { body: string } }>(THAMES_CONDITIONS_URL)).details.body))

export type RouteConditions = {
  gauges: GaugeReading[]
  thames: { updated?: string; reaches: ThamesReach[]; url: string } | null
  unavailable: string[]        // sources that couldn't be read just now
  fetchedAt: string
}

/** Gauges and Thames boards along a route line through `waterways` (its
 *  named rivers and canals). `locks` are the dataset's locks, to place the
 *  Thames reaches. */
export async function conditionsAlong(line: LatLng[], waterways: string[], locks: Feature[]): Promise<RouteConditions> {
  const unavailable: string[] = []
  const safe = async <T>(name: string, p: Promise<T>): Promise<T | null> => { try { return await p } catch { unavailable.push(name); return null } }
  const [ea, sepa, ie, nl, vl, de, boards] = await Promise.all([
    safe('Environment Agency', eaStations()), safe('SEPA', sepaStations()), safe('OPW', opw()), safe('Rijkswaterstaat', rwsNow()),
    safe('waterinfo.be', flanders()), safe('PEGELONLINE', germany()), safe('GOV.UK river conditions', thames()),
  ])
  const all: Gauge[] = [...(ea ?? []), ...(sepa ?? []), ...(ie ?? []), ...(nl?.gauges ?? []), ...(vl ?? []), ...(de ?? [])]
  const onRoute = gaugesAlong(line, all, waterways)

  const needEa = onRoute.some(g => g.source === 'ea'), needSepa = onRoute.filter(g => g.source === 'sepa').map(g => g.id)
  const [latest, sepaNow, typical] = await Promise.all([
    needEa ? safe('Environment Agency', eaLatest()) : null,
    needSepa.length ? safe('SEPA', sepaValues(needSepa)) : null,
    Promise.all(onRoute.map(g => (g.source === 'ea' && g.datum === 'stage' ? eaTypicalRange(g.id) : Promise.resolve(undefined)))),
  ])
  const withReading = new Map([...(ie ?? []), ...(vl ?? []), ...(de ?? [])].map(g => [`${g.source}:${g.id}`, g]))
  const gauges: GaugeReading[] = onRoute.map((g, i) => {
    const r = g.source === 'ea' ? latest?.get(g.measure ?? '') : undefined
    const s = g.source === 'sepa' ? sepaNow?.get(g.id) : g.source === 'rws' ? nl?.latest.get(g.id) : undefined
    const o = g.source === 'opw' || g.source === 'waterinfo' || g.source === 'pegelonline' ? withReading.get(`${g.source}:${g.id}`) : undefined
    const valueM = r?.value ?? s?.value ?? o?.valueM
    return {
      ...g, valueM, readAt: r?.dateTime ?? s?.at ?? o?.readAt,
      typical: typical[i], state: (o as { state?: GaugeReading['state'] } | undefined)?.state ?? (g.datum === 'stage' ? stateOf(valueM, typical[i]) : undefined), url: gaugeUrl(g),
    }
  })
  const reaches = boards ? thamesReachesOnRoute(boards.reaches, locks, line) : []
  return {
    gauges,
    thames: boards && reaches.length ? { updated: boards.updated, reaches, url: THAMES_CONDITIONS_PAGE } : null,
    unavailable: [...new Set(unavailable)],
    fetchedAt: new Date().toISOString(),
  }
}
