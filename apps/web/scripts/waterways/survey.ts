#!/usr/bin/env node
// Portages from a paddle on the water, with the river level at the time.
//
//   pnpm --filter web course:ingest <folder>            (GoPro only: GPS to track.json)
//   pnpm --filter web waterways:survey <track.json | .fit | .gpx | .tcx>
//       → .cache/waterways/survey/<date>/draft.json, plus a contact sheet per carry
//         for GoPro MAX footage (--yaw 180 when the camera faces the stern, the default)
//   fill in sides, takeOut, putIn and carry from the sheets, or set skip: true
//   pnpm --filter web waterways:survey --accept .cache/waterways/survey/<date>/draft.json
//       → packages/waterways/data/portage-survey.json, then `waterways dw` for the scorecard
//
// Only what a person has checked is accepted: see docs/features/waterways-uk-ireland-sources.md.
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { haversine } from '@paddlesnitch/timing/geo'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { eaGauges, gaugesAlong, stateOf, type Gauge } from '@paddlesnitch/waterways/live'
import { cumulative, project, slice } from '@paddlesnitch/waterways/line'
import { routePlan } from '@paddlesnitch/waterways/plan'
import { portagesFromTrack, type TrackPoint } from '@paddlesnitch/waterways/portage-detect'
import { readingAt, surveyEntry, uncheckedDrafts, withSurveyEntries, type SurveyDraft } from '@paddlesnitch/waterways/portage-survey'
import type { PortageObserved, PublicPortage } from '@paddlesnitch/waterways/portage'
import type { LatLng, RegionDataset } from '@paddlesnitch/waterways/types'

const EA = 'https://environment.data.gov.uk/flood-monitoring'
const UA = { 'User-Agent': 'paddlesnitch-river-planner (+https://paddlesnitch.com/plan)', Accept: 'application/json' }
const DATA = path.resolve(process.cwd(), '../../packages/waterways/data')
const SURVEY_FILE = path.join(DATA, 'portage-survey.json')
const NEAR_LINE_M = 400

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json() as Promise<T>
}

type Reading = { dateTime: string; value: number }
type GoproPoint = TrackPoint & { utc: string; file: string; ft: number }

/** Track points with `t` in Unix seconds and a speed in m/s. */
async function readTrack(file: string): Promise<{ points: TrackPoint[]; gopro?: GoproPoint[] }> {
  if (file.endsWith('.json')) {
    const track = (JSON.parse(fs.readFileSync(file, 'utf8')) as { track: GoproPoint[] }).track
    const gopro = track.filter((_, i) => i % 10 === 0).map(p => ({ ...p, t: Date.parse(p.utc) / 1000 }))
    return { points: gopro, gopro }
  }
  const buf = fs.readFileSync(file)
  const parsed = await parseTrace(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  if (!parsed.ok) throw new Error(`Couldn't read ${file}: ${parsed.reason}`)
  const points = parsed.track.map((p, i, all) => {
    const q = all[Math.max(0, i - 1)], dt = (p.timestamp.getTime() - q.timestamp.getTime()) / 1000
    return { t: p.timestamp.getTime() / 1000, lat: p.lat, lng: p.lng, speed: dt > 0 ? haversine([q.lat, q.lng], [p.lat, p.lng]) / dt : 0 }
  })
  return { points }
}

/** What the nearest gauge on the route read when the carry happened. EA keeps about four weeks of readings. */
async function gaugeAt(alongM: number, iso: string, gauges: (Gauge & { chainageM: number })[]): Promise<PortageObserved['gauge']> {
  // Nearest along the water: in a straight line a lock on the Kennet can be closer to a Thames gauge.
  const g = [...gauges].sort((a, b) => Math.abs(a.chainageM - alongM) - Math.abs(b.chainageM - alongM))[0]
  if (!g?.measure) return undefined
  const day = iso.slice(0, 10), range = `startdate=${day}&enddate=${day}&_sorted&_limit=200`
  const station = await json<{ items: { stageScale?: { typicalRangeLow?: number; typicalRangeHigh?: number }; measures: unknown } }>(`${EA}/id/stations/${encodeURIComponent(g.id)}`)
  const stage = readingAt((await json<{ items: Reading[] }>(`${g.measure}/readings?${range}`)).items, iso)
  if (!stage) return undefined
  const measures = [station.items.measures].flat() as { '@id': string; parameter?: string }[]
  const flowId = measures.find(m => m.parameter === 'flow')?.['@id']
  const flow = flowId ? readingAt((await json<{ items: Reading[] }>(`${flowId}/readings?${range}`)).items, iso) : undefined
  const s = station.items.stageScale
  const typical = typeof s?.typicalRangeLow === 'number' && typeof s?.typicalRangeHigh === 'number' ? { low: s.typicalRangeLow, high: s.typicalRangeHigh } : undefined
  return {
    source: 'ea', id: g.id, name: g.name, river: g.river, valueM: stage.value, readAt: stage.dateTime,
    ...(flow ? { flowM3s: flow.value } : {}), ...(g.datum === 'stage' && stateOf(stage.value, typical) ? { state: stateOf(stage.value, typical) } : {}),
  }
}

/** Take-out, closest pass and put-in, looking ahead, left and right from a GoPro MAX. */
function contactSheet(gopro: GoproPoint[], t: number[], out: string, yaw: number, files: Map<string, string>) {
  const rows = t.map((sec, i) => {
    const p = gopro.reduce((a, b) => (Math.abs(b.t - sec) < Math.abs(a.t - sec) ? b : a))
    const video = files.get(p.file)!
    const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video]).toString().trim().split(',').map(Number)
    const face = h, step = (w - face) / 2
    const crop = (s: string, x: number, name: string) => `[${s}]crop=${face}:${face}:${x}:0[${name}]`
    const eac = [crop('0:0', 0, 'l'), crop('0:0', step, 'f'), crop('0:0', 2 * step, 'r'), crop('0:4', 0, 'd'), crop('0:4', step, 'b'), crop('0:4', 2 * step, 'u')].join(';')
    const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
    const view = (a: string, b: string, y: number) => `[${a}]v360=eac:flat:yaw=${wrap(yaw + y)}:h_fov=100:v_fov=62:w=640:h=400[${b}]`
    const graph = `${eac};[l][f][r]hstack=3[top];[d][b][u]hstack=3[bot];[top][bot]vstack,split=3[a][b1][c];${view('a', 'A', 0)};${view('b1', 'B', -90)};${view('c', 'C', 90)};[A][B][C]hstack=3[o]`
    const row = `${out}.${i}.jpg`
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', p.ft.toFixed(1), '-i', video, '-filter_complex', graph, '-map', '[o]', '-frames:v', '1', '-q:v', '4', row])
    return row
  })
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...rows.flatMap(r => ['-i', r]), '-filter_complex', `vstack=${rows.length}`, '-q:v', '4', `${out}.jpg`])
  rows.forEach(r => fs.rmSync(r))
}

/** The route either side of a lock, which is all a landing's bank needs. */
const nearLine = (line: LatLng[], at: LatLng): LatLng[] => {
  const cum = cumulative(line), along = project(line, at, cum).along
  return slice(line, Math.max(0, along - NEAR_LINE_M), along + NEAR_LINE_M, cum).map(([lat, lng]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))])
}

function accept(file: string) {
  const drafts = JSON.parse(fs.readFileSync(file, 'utf8')) as SurveyDraft[]
  const checked = drafts.filter(d => !d.skip)
  const blank = uncheckedDrafts(drafts)
  if (blank.length) throw new Error(`Not checked yet: ${blank.map(d => d.lock).join(', ')}. Fill in sides, takeOut, putIn and carry, or set skip: true.`)
  const existing = JSON.parse(fs.readFileSync(SURVEY_FILE, 'utf8')) as PublicPortage[]
  fs.writeFileSync(SURVEY_FILE, `${JSON.stringify(withSurveyEntries(existing, checked.map(surveyEntry)), null, 1)}\n`)
  console.log(`${checked.length} carries in ${path.relative(process.cwd(), SURVEY_FILE)}. Run: pnpm --filter web waterways dw`)
}

async function main() {
  const args = process.argv.slice(2)
  const base = process.env.INIT_CWD ?? process.cwd()
  if (args[0] === '--accept') return accept(path.resolve(base, args[1]))
  const file = args[0] && path.resolve(base, args[0])
  if (!file) throw new Error('usage: waterways:survey <track> | --accept <draft.json>')
  const yaw = args.includes('--yaw') ? Number(args[args.indexOf('--yaw') + 1]) : 180

  const { points, gopro } = await readTrack(file)
  const ds = JSON.parse(fs.readFileSync(path.join(DATA, 'dw.json'), 'utf8')) as RegionDataset
  const carries = portagesFromTrack(points, ds.features.filter(f => f.kind === 'lock'))
  const first = points[0], last = points[points.length - 1]
  const route = routePlan(ds, { start: [first.lat, first.lng], finish: [last.lat, last.lng], shape: 'one_way' })
  if (typeof route === 'string') throw new Error(`Couldn't route the paddle: ${route}`)
  const stations = eaGauges((await json<{ items: unknown[] }>(`${EA}/id/stations?parameter=level&_limit=10000`)).items)
  const gauges = gaugesAlong(route.line, stations, route.waterways)
  console.log(`${carries.length} carries, ${gauges.length} gauges on the route: ${gauges.map(g => g.name).join(', ')}`)

  const date = new Date(first.t * 1000).toISOString().slice(0, 10)
  const out = path.join(process.cwd(), '.cache/waterways/survey', date)
  fs.mkdirSync(out, { recursive: true })
  const drafts: SurveyDraft[] = []
  for (const c of carries.sort((a, b) => a.t - b.t)) {
    const at = new Date(c.t * 1000).toISOString()
    drafts.push({ featureId: c.featureId, lock: c.name ?? c.featureId, at: c.at, landings: c.landings, line: nearLine(route.line, c.at), sides: ['', ''], observed: { at, gauge: await gaugeAt(project(route.line, c.at).along, at, gauges) }, takeOut: '', putIn: '', carry: '' })
    if (gopro && gopro[0].file) {
      const sources = (JSON.parse(fs.readFileSync(file, 'utf8')) as { sources: { file: string }[] }).sources
      const files = new Map(sources.map(s => [path.basename(s.file), s.file]))
      contactSheet(gopro, [c.t, c.t + c.minutes * 30, c.t + c.minutes * 60], path.join(out, (c.name ?? c.featureId).replace(/[^\w]+/g, '_')), yaw, files)
    }
    const g = drafts[drafts.length - 1].observed.gauge
    console.log(`  ${c.name}: ${g ? `${g.name} ${g.valueM} m ${g.state ?? ''} ${g.flowM3s ?? ''}` : 'no gauge reading'}`)
  }
  fs.writeFileSync(path.join(out, 'draft.json'), JSON.stringify(drafts, null, 1))
  console.log(`Draft: ${path.relative(process.cwd(), path.join(out, 'draft.json'))}`)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
