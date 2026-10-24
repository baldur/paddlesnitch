// The public, read-only /api/v1 (#511): a stable JSON shape over the same
// functions the pages use. Units are in field names (distance_km, duration_s),
// coordinates are plain lat/lng (GeoJSON, where used, is [lng, lat] as the
// format requires), times are ISO 8601 with an offset. Every response names
// its sources. Anonymous only: public data, the same visibility checks as the
// pages, no personal data beyond the display names a public leaderboard shows.
import { NextResponse } from 'next/server'
import type { ComputedPlan, Stop } from '@paddlesnitch/waterways/plan'
import type { Found } from '@paddlesnitch/waterways/find'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import type { LatLng, SourceId } from '@paddlesnitch/waterways/types'
import type { CourseMetadata, LeaderboardEntry, TrialMetadata } from '@/lib/types'
import { stopId } from '@/lib/plan-ui'

export const API_VERSION = '1'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

export function ok(body: object, cacheSeconds = 60): NextResponse {
  return NextResponse.json({ api_version: API_VERSION, ...body }, {
    headers: { ...CORS, 'Cache-Control': `public, max-age=${cacheSeconds}` },
  })
}

export type ApiErrorCode = 'bad_request' | 'not_found' | 'start_off_water' | 'finish_off_water' | 'too_short' | 'not_connected'

export function fail(status: number, code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json({ api_version: API_VERSION, error: { code, message } }, { status, headers: CORS })
}

/** CORS preflight; GETs without custom headers never send one, but be polite. */
export const options = () => new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })

const r3 = (n: number) => Math.round(n * 1000) / 1000
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const point = (p: LatLng) => ({ lat: r6(p[0]), lng: r6(p[1]) })

export type Attribution = { source: string; name: string; licence: string; attribution: string; url: string }

/** The credit for every source a response draws on; OpenStreetMap always (the network). */
export function attribution(sources: Iterable<SourceId>): Attribution[] {
  const ids = new Set<SourceId>(['osm', ...sources])
  return [...ids].filter(id => SOURCES[id]).map(id => ({ source: id, name: SOURCES[id].name, licence: SOURCES[id].licence, attribution: SOURCES[id].attribution, url: SOURCES[id].url }))
}

const OPENPORTAGE: Attribution = {
  source: 'openportage', name: 'OpenPortage: portage details shared by paddlers', licence: 'CC0 1.0',
  attribution: 'OpenPortage contributors (paddlesnitch)', url: 'https://paddlesnitch.com/plan/data/live/openportage',
}

function stop(s: Stop) {
  return {
    id: stopId(s),
    feature_id: s.feature.id,
    kind: s.feature.kind,
    name: s.feature.name ?? null,
    leg: s.leg,
    km: r3(s.chainageM / 1000),
    from_previous_km: r3(s.fromPrevM / 1000),
    elapsed_s: Math.round(s.elapsedS),
    eta: s.eta ?? null,
    bank: s.bank ?? null,
    portage: s.portage,
    beside_the_route: !!s.beside,
    ...point(s.feature.at),
    source: s.feature.source.source,
    source_url: s.feature.source.url ?? null,
    // Where paddlers (OpenPortage, CC0) or OpenStreetMap say to get out and back in.
    landings: (s.portages ?? []).map(p => ({
      take_out: { ...point(p.takeOut.at), bank: p.takeOut.bank },
      put_in: { ...point(p.putIn.at), bank: p.putIn.bank },
      carry_m: Math.round(p.carryM),
      rollers: p.rollers ?? null,
      notes: p.notes ?? null,
      source: p.osm ? 'osm' : 'openportage',
    })),
  }
}

export type PlanQuery = { from: LatLng; to: LatLng; shape: 'one_way' | 'return'; paceKmh: number; portageMinutes: number; startAt?: string }

export function planResponse(plan: ComputedPlan, q: PlanQuery, origin: string) {
  const page = new URL('/plan', origin)
  page.searchParams.set('from', `${q.from[0]},${q.from[1]}`)
  page.searchParams.set('to', `${q.to[0]},${q.to[1]}`)
  if (q.shape === 'return') page.searchParams.set('shape', 'return')
  return {
    plan: {
      shape: q.shape,
      pace_kmh: q.paceKmh,
      portage_minutes: q.portageMinutes,
      start: { ...point(plan.start.at), waterway: plan.start.waterway || null },
      finish: { ...point(plan.finish.at), waterway: plan.finish.waterway || null },
      distance_km: r3(plan.lengthM / 1000),
      turn_km: plan.turnM != null ? r3(plan.turnM / 1000) : null,
      moving_s: Math.round(plan.movingS),
      duration_s: Math.round(plan.totalS),
      portages: plan.portages,
      start_at: q.startAt ?? null,
      finish_at: plan.finishAt ?? null,
      waterways: plan.waterways ?? [],
      canoe_routes: plan.canoeRoutes ?? [],
      reaches_tidal_water_km: plan.tidalFromM != null ? r3(plan.tidalFromM / 1000) : null,
      route: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: plan.line.map(([lat, lng]) => [r6(lng), r6(lat)]) } },
      stops: plan.stops.map(stop),
    },
    links: { page: page.toString() },
    attribution: [
      ...attribution(plan.stops.map(s => s.feature.source.source)),
      ...(plan.stops.some(s => s.portages?.some(p => !p.osm)) ? [OPENPORTAGE] : []),
    ],
    notice: 'For planning only. paddlesnitch is not a navigation authority: check closures, river levels and, below Teddington and in the Netherlands, the tide.',
  }
}

export const placeResponse = (f: Found) => ({ name: f.name, kind: f.kind, waterway: f.waterway || null, ...point(f.at) })

export function trialSummary(t: TrialMetadata, course: CourseMetadata | null, origin: string) {
  return {
    id: t.id,
    name: t.name,
    date: t.date,
    status: t.status,
    participation: t.participation === ('open' as string) ? 'public' : t.participation,
    course: course ? {
      id: course.id,
      name: course.name,
      type: course.type,
      sport: course.sport,
      distance_km: r3(course.distanceMetres / 1000),
      start_line: course.startLine.map(point),
      finish_line: course.finishLine ? course.finishLine.map(point) : null,
      gates: course.gates?.map((g, i) => ({ number: i + 1, line: g.line.map(point), direction: g.direction })) ?? null,
    } : null,
    links: { page: new URL(`/att/trials/${t.id}`, origin).toString(), leaderboard: new URL(`/api/v1/trials/${t.id}/leaderboard`, origin).toString() },
  }
}

/** A public leaderboard as the page shows it: names, boats, times. No user ids. */
export const leaderboardResponse = (rows: LeaderboardEntry[]) => [...rows]
  .sort((a, b) => a.totalElapsedSeconds - b.totalElapsedSeconds)
  .map((e, i) => ({
    rank: i + 1,
    display_name: e.displayName,
    boat_class: e.boatClass,
    elapsed_s: r3(e.totalElapsedSeconds),
    race_date: e.raceDate,
    submitted_at: e.submittedAt,
    avg_stroke_rate_spm: e.avgStrokeRate != null ? Math.round(e.avgStrokeRate * 10) / 10 : null,
    splits: e.splits.map(s => ({ distance_m: Math.round(s.distance), elapsed_s: r3(s.elapsedSeconds) })),
  }))

/** "lat,lng" → LatLng, or null. */
export function latLngParam(v: string | null): LatLng | null {
  const m = v ? /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v) : null
  if (!m) return null
  const p: LatLng = [Number(m[1]), Number(m[2])]
  return Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 ? p : null
}
