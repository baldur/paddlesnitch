// Our own tide fit (packages/waterways/src/tide.ts): recovers a known tide,
// finds its high and low waters, and backtests honestly.
import { describe, expect, it } from 'vitest'
import { backtest, CONSTITUENTS, fitTide, observedHighs, tideAt, tideExtremes, type TideSample, type TidesFile } from '@paddlesnitch/waterways/tide'
import { tideNote, tideWindow } from './plan-ui'

const RAD = Math.PI / 180
const START = Date.parse('2026-01-01T00:00:00Z')
// A synthetic upper-estuary tide: M2 + S2 + K1 + a strong M4 (the lopsided shape).
const truth = (t: number) => {
  const h = (t - START) / 3_600_000
  return 0.5 + 3.2 * Math.cos(CONSTITUENTS.M2 * RAD * h - 1.1) + 0.9 * Math.cos(CONSTITUENTS.S2 * RAD * h - 0.4)
    + 0.2 * Math.cos(CONSTITUENTS.K1 * RAD * h + 0.7) + 0.45 * Math.cos(CONSTITUENTS.M4 * RAD * h + 2.0)
}
const samples = (days: number, noise = 0): TideSample[] =>
  Array.from({ length: days * 96 }, (_, i) => { const t = START + i * 15 * 60_000; return { t, h: truth(t) + noise * Math.sin(i * 12.9898) } })

describe('tide fit', () => {
  it('recovers a known tide from 60 days of 15-minute readings', () => {
    const model = fitTide(samples(60, 0.05), ['M2', 'S2', 'K1', 'M4', 'O1'])
    const m2 = model.terms.find(t => t.name === 'M2')!
    expect(Math.hypot(m2.a, m2.b)).toBeCloseTo(3.2, 1)
    expect(model.z0).toBeCloseTo(0.5, 1)
    const later = START + 70 * 86_400_000
    expect(Math.abs(tideAt(model, later) - truth(later))).toBeLessThan(0.1)   // predicts beyond the data
  })

  it('finds high and low waters to the minute, alternating', () => {
    const model = fitTide(samples(30), ['M2', 'S2', 'K1', 'M4'])
    const day = START + 40 * 86_400_000
    const ex = tideExtremes(model, day, day + 86_400_000)
    expect(ex.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < ex.length; i++) expect(ex[i].type).not.toBe(ex[i - 1].type)
    // A high water really is a local maximum of the true curve (within 2 minutes' worth).
    const hw = Date.parse(ex.find(e => e.type === 'high')!.at)
    expect(truth(hw)).toBeGreaterThan(truth(hw - 5 * 60_000) - 0.01)
    expect(truth(hw)).toBeGreaterThan(truth(hw + 5 * 60_000) - 0.01)
  })

  it('backtests: high-water timing errors on held-out data are small for a good fit', () => {
    const all = samples(60, 0.02)
    const train = all.slice(0, 45 * 96), test = all.slice(45 * 96)
    const r = backtest(fitTide(train, ['M2', 'S2', 'K1', 'M4']), test)
    expect(r.n).toBeGreaterThan(20)
    expect(r.medianMin).toBeLessThanOrEqual(3)
    expect(r.p95Min).toBeLessThanOrEqual(8)
  })

  it('counts a gauge fault (a "high water" metres off) out of the backtest instead of scoring it', () => {
    const all = samples(60, 0.02)
    // A fault on one high water: the readings around it 2 m low (still a peak, just a wrong one).
    const clean = all.slice(45 * 96)
    const hw = observedHighs(clean)[3].t
    const test = clean.map(s => (Math.abs(s.t - hw) <= 4 * 3_600_000 ? { ...s, h: s.h - 2 } : s))
    const r = backtest(fitTide(all.slice(0, 45 * 96), ['M2', 'S2', 'K1', 'M4']), test)
    expect(r.faults).toBeGreaterThan(0)
    expect(r.p95Min).toBeLessThanOrEqual(8)
  })

  it('observed high waters: one per tide, not one per wobble', () => {
    expect(observedHighs(samples(2)).length).toBeGreaterThanOrEqual(3)
    expect(observedHighs(samples(2)).length).toBeLessThanOrEqual(4)
  })
})

describe('the tide window on a plan', () => {
  const model = fitTide(samples(30), ['M2', 'S2', 'K1', 'M4'])
  const gauge = (lows: boolean, p95Min: number) => ({ label: lows ? 'Tower Pier' : 'Richmond', at: [51.5, -0.1] as [number, number], lows, from: '', to: '', backtest: { n: 50, faults: 0, medianMin: 4, p95Min, medianHeightM: 0.1 }, model })
  const file: TidesFile = { fittedAt: '', credit: '', gauges: { richmond: gauge(false, 12), towerPier: gauge(true, 15), poor: { ...gauge(true, 90), label: 'Poor fit' } } }
  const plan = {
    start: { at: [51.4, -0.4] as [number, number], waterway: 'River Thames' }, finish: { at: [51.5, -0.1] as [number, number], waterway: 'River Thames' },
    line: [[51.4, -0.4], [51.5, -0.1]] as [number, number][], lengthM: 20_000, portages: 1, movingS: 0, totalS: 0, tidalFromM: 8_000,
    stops: [{ feature: { id: 'l', kind: 'lock' as const, at: [51.43, -0.32] as [number, number], source: { source: 'ea-thames-locks' as const, fetchedAt: '' } }, leg: 'out' as const, chainageM: 7_900, fromPrevM: 0, portage: true, portagesBefore: 0, elapsedS: 0 }],
  }

  it('says when you reach tidal water (pace plus portages) and how that sits against high water', () => {
    const w = tideWindow(plan, { paceKmh: 8, portageMinutes: 5, startAt: '2026-02-10T08:00:00.000Z' }, file)!
    expect(w.reachAt).toBe('2026-02-10T09:05:00.000Z')                   // 8 km at 8 km/h + one 5-minute portage
    expect(w.gauges.map(g => g.label)).toEqual(['Richmond', 'Tower Pier'])   // the poor fit isn't shown
    expect(w.gauges[0].extremes.every(e => e.type === 'high')).toBe(true)   // Richmond: high waters only
    expect(w.afterHigh?.gauge).toBe('Richmond')
    expect(Math.abs(w.afterHigh!.minutes)).toBeLessThan(7 * 60)
  })

  it("shows no tide where the route meets tidal water far from any gauge (the Severn isn't the Thames)", () => {
    const severn = { ...plan, line: [[51.85, -2.25], [51.70, -2.45]] as [number, number][], finish: { at: [51.70, -2.45] as [number, number], waterway: 'River Severn' } }
    expect(tideWindow(severn, { paceKmh: 8, portageMinutes: 5, startAt: '2026-02-10T08:00:00.000Z' }, file)).toBeNull()
  })

  it('in Zeeland: the Dutch gauges near where the route meets the tide, nearest first, on NAP', () => {
    const nl = (label: string, at: [number, number]) => ({ ...gauge(true, 15), label, at, datum: 'NAP' as const })
    const dutch: TidesFile = { ...file, gauges: { ...file.gauges, vlissingen: nl('Vlissingen', [51.442, 3.6]), terneuzen: nl('Terneuzen', [51.336, 3.82]) } }
    const zeeland = { ...plan, line: [[51.50, 3.70], [51.40, 3.70]] as [number, number][], finish: { at: [51.40, 3.70] as [number, number], waterway: 'Westerschelde' }, tidalFromM: 2_000 }
    const w = tideWindow(zeeland, { paceKmh: 8, portageMinutes: 5, startAt: '2026-02-10T08:00:00.000Z' }, dutch)!
    expect(w.gauges.map(g => g.label)).toEqual(['Vlissingen', 'Terneuzen'])   // no Thames gauge, the nearer first
    expect(w.afterHigh?.gauge).toBe('Vlissingen')
    expect(tideNote(w)).toContain('heights above NAP')
    expect(tideNote(tideWindow(plan, { paceKmh: 8, portageMinutes: 5, startAt: '2026-02-10T08:00:00.000Z' }, dutch)!)).toContain('Ordnance Datum')
  })

  it('needs a start time and a route that reaches tidal water', () => {
    expect(tideWindow(plan, { paceKmh: 8, portageMinutes: 5 }, file)).toBeNull()
    expect(tideWindow({ ...plan, tidalFromM: undefined }, { paceKmh: 8, portageMinutes: 5, startAt: '2026-02-10T08:00:00.000Z' }, file)).toBeNull()
  })
})
