#!/usr/bin/env node
// Fit tide models for the tidal Thames from the EA's archived tide-gauge
// readings (OGL), and backtest them before anyone sees a prediction.
//
//   pnpm --filter web waterways:tides
//
// Reads the filtered daily archives in .cache/waterways/tides/raw/ (see the
// download step in docs/features/river-planner.md, "Tides"), fits each gauge
// on all but the last 30 days, backtests high-water times on those 30 days,
// then refits on everything and writes packages/waterways/data/tides.json.
import fs from 'fs'
import path from 'path'
import { backtest, fitTide, type TideSample } from '@paddlesnitch/waterways/tide'

const RAW = path.join(process.cwd(), '.cache/waterways/tides/raw')
const OUT = path.resolve(process.cwd(), '../../packages/waterways/data/tides.json')

/** The gauges, upstream first: Richmond for highs only (its half-tide lock
 *  holds the water up at low tide); Westminster and Tower Pier for both. */
const GAUGES = {
  richmond: { label: 'Richmond', at: [51.4561, -0.3062], measure: '0009-level-tidal_level-i-15_min-mAOD', lows: false },
  westminster: { label: 'Westminster', at: [51.5009, -0.1236], measure: '0006-level-tidal_level-i-15_min-mAOD', lows: true },
  towerPier: { label: 'Tower Pier', at: [51.5072, -0.0774], measure: '0007-level-tidal_level-i-15_min-mAOD', lows: true },
} as const

const DAY = 86_400_000
const TEST_DAYS = 30

function series(measure: string): TideSample[] {
  const seen = new Map<number, number>()
  for (const f of fs.readdirSync(RAW).filter(f => f.endsWith('.csv')).sort()) {
    for (const line of fs.readFileSync(path.join(RAW, f), 'utf8').split('\n')) {
      if (!line.includes(`/${measure},`)) continue
      const [time, , value] = line.split(',')
      const t = Date.parse(time), h = Number(value)
      if (Number.isFinite(t) && Number.isFinite(h)) seen.set(t, h)
    }
  }
  return [...seen].map(([t, h]) => ({ t, h })).sort((a, b) => a.t - b.t)
}

/** Drop readings far off a running median: stuck sensors and spikes. */
function clean(s: TideSample[]): TideSample[] {
  return s.filter((x, i) => {
    const win = s.slice(Math.max(0, i - 4), i + 5).map(y => y.h).sort((a, b) => a - b)
    return Math.abs(x.h - win[Math.floor(win.length / 2)]) < 1.5
  })
}

const out: Record<string, unknown> = {}
for (const [id, g] of Object.entries(GAUGES)) {
  const all = clean(series(g.measure))
  if (all.length < 1000) { console.log(`  ${g.label}: only ${all.length} readings, skipped`); continue }
  const end = all.at(-1)!.t
  const train = all.filter(s => s.t < end - TEST_DAYS * DAY), test = all.filter(s => s.t >= end - TEST_DAYS * DAY)
  const check = backtest(fitTide(train), test)
  const model = fitTide(all)
  console.log(`  ${g.label}: ${all.length} readings ${new Date(all[0].t).toISOString().slice(0, 10)}–${new Date(end).toISOString().slice(0, 10)}; held-out ${TEST_DAYS} days: ${check.n} high waters (${check.faults} gauge faults left out), median ${check.medianMin} min, 95% within ${check.p95Min} min, height ${check.medianHeightM} m`)
  out[id] = { label: g.label, at: g.at, lows: g.lows, from: new Date(all[0].t).toISOString(), to: new Date(end).toISOString(), backtest: check, model }
}
fs.writeFileSync(OUT, JSON.stringify({ fittedAt: new Date().toISOString(), credit: 'Contains Environment Agency data, OGL v3', gauges: out }, null, 1) + '\n')
console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
