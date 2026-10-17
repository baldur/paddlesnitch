// Live conditions along a route (docs/features/river-planner.md, P5): river
// levels from the gauges near it and the Thames stream-warning boards. Pure
// parsers here; fetching and caching are in live-store.ts (server only).
// Everything is best-effort: a source that fails is reported as unknown,
// never as "no warning".
import { along } from './along'
import { lockKey } from './build'
import { haversine } from '@paddlesnitch/timing/geo'
import type { Feature, LatLng } from './types'

export type GaugeSource = 'ea' | 'sepa' | 'opw'

export type Gauge = {
  source: GaugeSource
  id: string                   // EA station reference, SEPA ts_id, OPW station ref
  name: string
  river?: string
  at: LatLng
  measure?: string             // EA: the stage measure's id, for its latest reading
  /** The reading is on the gauge's own scale (EA mASD/m, SEPA, OPW), which
   *  the typical range uses; 'aod' is metres above sea level, not comparable. */
  datum?: 'stage' | 'aod'
}

export type GaugeReading = Gauge & {
  chainageM: number
  valueM?: number              // stage, metres
  readAt?: string              // ISO
  typical?: { low: number; high: number }
  state?: 'low' | 'normal' | 'high'
  url: string                  // where a person can check it
}

/** A gauge this close to the route is on it. */
export const GAUGE_NEAR_M = 1000
/** At most this many gauges, spread evenly along the route. */
export const MAX_GAUGES = 12

/** A gauge with no river named must be this close to count. */
export const GAUGE_UNNAMED_NEAR_M = 300

const riverKey = (s: string) => s.toLowerCase().replace(/^(river|the)\s+/, '').replace(/\s+/g, ' ').trim()

/** The gauges on a route, in travel order, thinned evenly to MAX_GAUGES. A
 *  gauge that names its river counts only on a river the route paddles (not a
 *  tributary gauged near where it joins); one that doesn't must be close. */
export function gaugesAlong(line: LatLng[], gauges: Gauge[], waterways: string[], max = MAX_GAUGES): (Gauge & { chainageM: number })[] {
  const rivers = new Set(waterways.map(riverKey))
  const on = along(line, gauges, g => g.at, g => (g.river ? GAUGE_NEAR_M : GAUGE_UNNAMED_NEAR_M))
    .filter(a => !a.item.river || rivers.has(riverKey(a.item.river)))
    .map(a => ({ ...a.item, chainageM: Math.round(a.chainageM) }))
  if (on.length <= max) return on
  return Array.from({ length: max }, (_, i) => on[Math.round((i * (on.length - 1)) / (max - 1))])
}

export function stateOf(value: number | undefined, typical: GaugeReading['typical']): GaugeReading['state'] {
  if (value === undefined || !typical) return undefined
  return value > typical.high ? 'high' : value < typical.low ? 'low' : 'normal'
}

export const gaugeUrl = (g: Gauge): string =>
  g.source === 'ea' ? `https://check-for-flooding.service.gov.uk/station/${encodeURIComponent(g.id)}`
    : g.source === 'sepa' ? 'https://waterlevels.sepa.org.uk/'
      : `https://waterlevel.ie/${g.id}/0001/`

// --- Parsing each source's station list ----------------------------------------

/** EA flood-monitoring level stations: keep the upstream "Stage" measure,
 *  preferably on the gauge's own scale (mASD or m), else above sea level (mAOD). */
export function eaGauges(items: unknown[]): Gauge[] {
  const out: Gauge[] = []
  for (const raw of items) {
    const s = raw as Record<string, unknown>
    const lat = Number(s.lat), lng = Number(s.long)
    // EA gauges without a river named are mostly structures (flood gates, a
    // backup sensor): only gauges on a named river are matched to a route.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof s.stationReference !== 'string' || typeof s.riverName !== 'string') continue
    const measures = (Array.isArray(s.measures) ? s.measures : s.measures ? [s.measures] : []) as Record<string, unknown>[]
    const stages = measures.filter(m => m.qualifier === 'Stage' && typeof m['@id'] === 'string')
    const own = stages.find(m => m.unitName === 'mASD' || m.unitName === 'm')
    const pick = own ?? stages.find(m => m.unitName === 'mAOD')
    if (!pick) continue
    out.push({
      source: 'ea', id: s.stationReference, name: String(s.label ?? s.stationReference), river: s.riverName,
      at: [lat, lng], measure: String(pick['@id']), datum: own ? 'stage' : 'aod',
    })
  }
  return out
}

/** SEPA KiWIS getTimeseriesList rows: [ts_id, station_name, lat, lng] after the header. */
export function sepaGauges(rows: unknown[][]): Gauge[] {
  return rows.slice(1).flatMap(([id, name, lat, lng]) => {
    const at: LatLng = [Number(lat), Number(lng)]
    return Number.isFinite(at[0]) && Number.isFinite(at[1]) && id ? [{ source: 'sepa' as const, id: String(id), name: String(name), at, datum: 'stage' as const }] : []
  })
}

/** OPW latest readings (GeoJSON): water level sensors (0001) only, and only the
 *  stations OPW lets us republish (references up to 41000). */
export function opwGauges(fc: { features?: unknown[] }): (Gauge & { valueM?: number; readAt?: string })[] {
  const out: (Gauge & { valueM?: number; readAt?: string })[] = []
  for (const raw of fc.features ?? []) {
    const f = raw as { properties?: Record<string, unknown>; geometry?: { coordinates?: [number, number] } }
    const p = f.properties ?? {}
    const ref = String(p.station_ref ?? '')
    if (p.sensor_ref !== '0001' || !ref || Number(ref) > 41000 || !f.geometry?.coordinates) continue
    const [lng, lat] = f.geometry.coordinates
    const v = Number(p.value)
    out.push({ source: 'opw', id: ref, name: String(p.station_name ?? ref), at: [lat, lng], datum: 'stage', valueM: Number.isFinite(v) ? v : undefined, readAt: typeof p.datetime === 'string' ? p.datetime : undefined })
  }
  return out
}

// --- The Thames boards -----------------------------------------------------------

export type ThamesReach = { from: string; to?: string; condition: string; level: 'none' | 'caution' | 'strong' | 'other' }
export type ThamesConditions = { updated?: string; reaches: ThamesReach[] }

export const THAMES_CONDITIONS_URL = 'https://www.gov.uk/api/content/guidance/river-thames-current-river-conditions'
export const THAMES_CONDITIONS_PAGE = 'https://www.gov.uk/guidance/river-thames-current-river-conditions'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim()

/** Every reach row from the GOV.UK "current river conditions" page. */
export function parseThamesConditions(body: string): ThamesConditions {
  const updated = body.match(/<h2[^>]*>\s*Current river conditions:\s*updated\s*([^<]+)<\/h2>/i)?.[1]?.trim()
  const reaches: ThamesReach[] = []
  for (const row of body.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    const reach = text(row[1]), condition = text(row[2])
    const m = reach.match(/^(.+?)\s+to\s+(.+)$/i)
    // The page names the boards: red is strong stream, yellow is caution.
    const level = /no stream warning/i.test(condition) ? 'none'
      : /red board/i.test(condition) ? 'strong'
        : /yellow board|caution/i.test(condition) ? 'caution' : 'other'
    reaches.push({ from: m ? m[1] : reach, to: m?.[2], condition, level })
  }
  return { updated, reaches }
}

/** The reaches a route is on: one of its end locks is within 300 m of the
 *  route, or the route starts or finishes between them. */
export function thamesReachesOnRoute(reaches: ThamesReach[], locks: Feature[], line: LatLng[]): ThamesReach[] {
  const byKey = new Map(locks.filter(l => l.kind === 'lock' && l.name).map(l => [lockKey(l.name), l.at]))
  const near = (p: LatLng | undefined) => !!p && along(line, [p], x => x, () => 300).length > 0
  const ends = [line[0], line.at(-1)!]
  return reaches.filter(r => {
    const a = byKey.get(lockKey(r.from)), b = r.to ? byKey.get(lockKey(r.to)) : undefined
    if (near(a) || near(b)) return true
    if (!a || !b) return false
    const span = haversine(a, b)
    return ends.some(e => haversine(e, a) + haversine(e, b) <= span * 1.3 + 500)
  })
}
