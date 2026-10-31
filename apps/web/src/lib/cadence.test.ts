// Stroke rate on the server: the recorder core (recorder-core/, C) built for
// WebAssembly, through @paddlesnitch/timing/cadence. The maths is tested in
// recorder-core/ (known answers, rules at their edges, fixtures); these check
// that the module the site ships is that core, and that the wrapper reads its
// lines and gates the way the callers rely on.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  recordingStrokeRate, replayStrokeLines, decimateMotionCsv, STROKE_RATE_REASONS, parseMotionCsv, trackClockOffset, withStrokeRate,
} from '@paddlesnitch/timing/cadence'
import { movingRangesFromTrack } from '@paddlesnitch/timing/attitude'
import { addStrokeRate } from '@paddlesnitch/analysis/device-sessions'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'
import { HEADER, sidecar, trackCsv } from '@/tests/tracker-fixtures'

const CORE = path.resolve(__dirname, '../../../../recorder-core')

// Motion alone: the ungated set (a recording whose GPS failed).
const ungated = (motion: string) => recordingStrokeRate('', motion).all.report

// A track parked or moving, stretch by stretch: [seconds, km/h].
function track(...stretches: [number, number][]): string {
  const rows: string[] = []
  let s = 0
  for (const [seconds, kmh] of stretches) {
    for (let i = 0; i < seconds; i++, s++) {
      const ts = new Date(Date.parse('2026-10-06T09:00:00Z') + s * 1000).toISOString().replace('.000Z', 'Z')
      rows.push(`${ts},${s * 1000},1,51.500000,-0.978,${kmh}`)
    }
  }
  return ['timestamp,ms,fix,lat,lon,speed_kmh', ...rows].join('\n')
}

describe('the module is the recorder core', () => {
  // The same check as recorder-core's own runners: every fixture's track and
  // motion files, replayed, give its stroke lines byte for byte.
  const dirs = readdirSync(path.join(CORE, 'fixtures')).filter(d => existsSync(path.join(CORE, 'fixtures', d, 'stroke.csv')))

  it('has fixtures to replay', () => expect(dirs.length).toBeGreaterThan(5))

  it.each(dirs)('replays fixtures/%s to its stroke lines', dir => {
    const read = (f: string) => readFileSync(path.join(CORE, 'fixtures', dir, f), 'latin1')
    const lines = replayStrokeLines(read('track.csv'), read('motion.csv'))
    expect(lines.map(l => `${l}\n`).join('')).toBe(read('stroke.csv'))
  })

  it("reads the stroke fixture's known answers", () => {
    const fx = (f: string) => readFileSync(path.join(CORE, 'fixtures/stroke_paddle', f), 'latin1')
    const r = recordingStrokeRate(fx('track.csv'), fx('motion.csv'))
    // session,moving,1,ok,10,59.0,360,355 and session,all,1,ok,12,59.0,420,414
    expect(r.moving.report).toMatchObject({ available: true, medianStrokesPerMin: 59, rows: 5600, sampleRateHz: 12.3 })
    expect(r.moving.report.windows).toHaveLength(10)
    expect(r.moving.paddling).toEqual({ paddlingS: 360, strokes: 355, strokesPerMin: 59 })
    expect(r.all.report.windows).toHaveLength(12)
    expect(r.all.paddling).toEqual({ paddlingS: 420, strokes: 414, strokesPerMin: 59 })
    expect(r.series).toHaveLength(60)
    expect(r.series[0]).toEqual({ ms: 72_500, strokesPerMin: 56, confidence: 0.854 })
  })
})

describe('stroke rate for a recording', () => {
  it('recovers a known alternating stroke rate', () => {
    const r = ungated(sidecar({ seconds: 180, hz: 50, strokesPerMin: 56 }))
    expect(r.available).toBe(true)
    expect(r.medianStrokesPerMin).toBeGreaterThan(55)
    expect(r.medianStrokesPerMin).toBeLessThan(57)
    expect(r.windows[0].alternating).toBe(true)
    // 60 s windows at 0, 30, 60 and 90 s: the one at 120 s would end on the last sample
    expect(r.reason).toBe('Derived from 4 windows of 60s at 50 Hz.')
  })

  it('does NOT double a single-sided rhythm', () => {
    const r = ungated(sidecar({ seconds: 180, hz: 50, strokesPerMin: 50, alternating: false }))
    expect(r.available).toBe(true)
    expect(r.windows[0].alternating).toBe(false)
    expect(r.medianStrokesPerMin).toBeGreaterThan(46)
    expect(r.medianStrokesPerMin).toBeLessThan(54)
  })

  it('reports no stroke rate for a stationary device instead of inventing one', () => {
    let seed = 3
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 2 }
    const rows = Array.from({ length: 3000 }, (_, i) =>
      `${i * 20},0.01,0.02,1.00,${(rnd() * 3).toFixed(3)},${(rnd() * 3).toFixed(3)},${(rnd() * 3).toFixed(3)}`)
    const r = ungated([HEADER, ...rows].join('\n'))
    expect(r).toMatchObject({ available: false, medianStrokesPerMin: null, windows: [] })
    expect(r.reason).toMatch(/^No window showed a clear repeating stroke pattern/)
  })

  it('refuses data sampled too slowly to carry a stroke', () => {
    const r = ungated(sidecar({ seconds: 300, hz: 1, strokesPerMin: 56 }))
    expect(r.available).toBe(false)
    expect(r.reason).toBe('Motion data is sampled at 1.0 Hz — too slow for a 0.5–2 Hz stroke.')
  })

  it('refuses a motion file with too few samples', () => {
    expect(ungated(sidecar({ seconds: 5, hz: 10, strokesPerMin: 56 })).reason).toBe('Motion file has too few samples to derive cadence.')
  })

  it("has words for every reason the core gives, never the raw code", () => {
    const header = readFileSync(path.join(CORE, 'include/recorder_core.h'), 'utf8')
    const listed = /\* reason: ([a-z_, ]+)\./.exec(header)?.[1].split(', ')
    expect(listed).toEqual(['ok', 'too_few_samples', 'too_slow', 'no_rhythm'])
    for (const r of listed!) expect(STROKE_RATE_REASONS[r]).toBeDefined()
  })

  it("says the rate is unknown when a motion file's clock never moves forward", () => {
    // Lines written backwards: the core reads files as they come (recorder_core.h, rc_replay).
    const [head, ...rows] = sidecar({ seconds: 60, hz: 10, strokesPerMin: 56 }).split('\n')
    const r = ungated([head, ...rows.reverse()].join('\n'))
    expect(r.available).toBe(false)
    expect(r.reason).toBe('Motion data is sampled at ? Hz — too slow for a 0.5–2 Hz stroke.')
  })

  it('reads a CR LF track whose speed is the last column', () => {
    const motion = sidecar({ seconds: 180, hz: 10, strokesPerMin: 56 })
    const lf = recordingStrokeRate(track([180, 9]), motion).moving.report
    expect(lf.available).toBe(true)
    expect(recordingStrokeRate(track([180, 9]).replace(/\n/g, '\r\n'), motion.replace(/\n/g, '\r\n')).moving.report).toEqual(lf)
  })

  it('counts only windows where the track says the boat was moving', () => {
    // 120 s parked, then 180 s paddling: the shape of every real session.
    const parked = Array.from({ length: 120 * 50 }, (_, i) => `${i * 20},0.01,0.02,1.00,0.1,0.2,0.1`)
    const moving = sidecar({ seconds: 180, hz: 50, strokesPerMin: 56, startMs: 120_000 }).split('\n').slice(1)
    const r = recordingStrokeRate(track([120, 0], [180, 9]), [HEADER, ...parked, ...moving].join('\n'))
    expect(r.moving.report.available).toBe(true)
    expect(r.moving.report.windows.length).toBeGreaterThan(0)
    expect(r.moving.report.windows.every(w => w.tMs >= 120_000)).toBe(true)
  })

  it('gives no gated stroke rate when the track never moves (the ungated set is for that)', () => {
    const r = recordingStrokeRate(track([180, 0]), sidecar({ seconds: 180, hz: 50, strokesPerMin: 56 }))
    expect(r.moving.report.available).toBe(false)
    expect(r.all.report.available).toBe(true)
  })

  it('finds the paddling time, strokes and a rest from the motion alone', () => {
    // 12 min paddling, 5 min still, 12 min paddling.
    const csv = [HEADER, ...[
      sidecar({ seconds: 720, hz: 10, strokesPerMin: 50 }),
      sidecar({ seconds: 300, hz: 10, strokesPerMin: 50, amplitude: 0, startMs: 720_000 }),
      sidecar({ seconds: 720, hz: 10, strokesPerMin: 50, startMs: 1_020_000 }),
    ].flatMap(p => p.split('\n').slice(1))].join('\n')
    const { all } = recordingStrokeRate('', csv)
    expect(all.rests).toHaveLength(1)
    const [from, to] = all.rests[0]
    expect(from).toBeGreaterThanOrEqual(700_000)
    expect(to).toBeLessThanOrEqual(1_040_000)
    expect(all.paddling!.paddlingS).toBeGreaterThan(22 * 60)
    expect(all.paddling!.paddlingS).toBeLessThan(25 * 60)
    expect(all.paddling!.strokes).toBeCloseTo(all.paddling!.paddlingS * 50 / 60, -1)
  })

  // The 13 Sep reference capture is private (the repo is public), so this
  // runs only where it is: ~/Documents/paddlesnitch-tracker-capture-2026-09-13.
  const REF = path.join(homedir(), 'Documents/paddlesnitch-tracker-capture-2026-09-13')
  it.skipIf(!existsSync(REF))('reads the 13 Sep reference at 50.6 spm (the server read 58.0 before phase 2b)', () => {
    const t = readFileSync(path.join(REF, 'track_20260913_081130.csv'), 'utf8')
    const m = readFileSync(path.join(REF, 'track_20260913_081130_imu.csv'), 'utf8')
    expect(recordingStrokeRate(t, m).moving.report).toMatchObject({ medianStrokesPerMin: 50.6, sampleRateHz: 50 })
  })
})

describe('stroke rate through the paddle', () => {
  const at = (pts: { ms: number; strokesPerMin: number }[], from: number, to: number) =>
    pts.filter(p => p.ms >= from && p.ms < to).map(p => p.strokesPerMin)
  const joined = (...parts: string[]) => [HEADER, ...parts.flatMap(p => p.split('\n').slice(1))].join('\n')

  it('follows a change of rate instead of averaging it away', () => {
    const { series } = recordingStrokeRate(track([240, 9]), joined(
      sidecar({ seconds: 120, hz: 10, strokesPerMin: 48 }),
      sidecar({ seconds: 120, hz: 10, strokesPerMin: 72, startMs: 120_000 }),
    ))
    expect(at(series, 0, 100_000).length).toBeGreaterThan(5)
    for (const v of at(series, 0, 100_000)) { expect(v).toBeGreaterThan(46); expect(v).toBeLessThan(50) }
    for (const v of at(series, 140_000, 240_000)) { expect(v).toBeGreaterThan(69); expect(v).toBeLessThan(75) }
  })

  it('leaves a rest as a gap, never a zero or a guess', () => {
    const { series } = recordingStrokeRate(track([240, 9]), joined(
      sidecar({ seconds: 90, hz: 10, strokesPerMin: 56 }),
      sidecar({ seconds: 60, hz: 10, strokesPerMin: 56, amplitude: 0, startMs: 90_000 }),
      sidecar({ seconds: 90, hz: 10, strokesPerMin: 56, startMs: 150_000 }),
    ))
    expect(at(series, 105_000, 135_000)).toEqual([])
    expect(at(series, 0, 80_000).length).toBeGreaterThan(5)
    expect(at(series, 160_000, 240_000).length).toBeGreaterThan(5)
    expect(series.every(p => p.strokesPerMin > 50)).toBe(true)
  })

  it('only uses stretches where the boat was moving', () => {
    const { series } = recordingStrokeRate(track([60, 0], [60, 9], [60, 0]), sidecar({ seconds: 180, hz: 10, strokesPerMin: 56 }))
    expect(series.length).toBeGreaterThan(0)
    expect(series.every(p => p.ms >= 60_000 && p.ms <= 120_000)).toBe(true)
  })

  it('gives single-sided paddling no series yet (only calibrated on synthetic data)', () => {
    expect(recordingStrokeRate(track([180, 9]), sidecar({ seconds: 180, hz: 10, strokesPerMin: 40, alternating: false })).series).toEqual([])
  })

  it('gives too short a recording no series: too few windows to decide left/right', () => {
    expect(recordingStrokeRate(track([40, 9]), sidecar({ seconds: 40, hz: 10, strokesPerMin: 56 })).series).toEqual([])
  })
})

describe('the motion file and the track', () => {
  it('reads the sidecar with or without a header row', () => {
    const withHeader = sidecar({ seconds: 2, hz: 50, strokesPerMin: 60 })
    expect(parseMotionCsv(withHeader).length).toBe(100)
    expect(parseMotionCsv(withHeader.split('\n').slice(1).join('\n')).length).toBe(100)
  })

  it("thins a sidecar to every Nth line, as trackers uploaded before 17 Sep", () => {
    const full = sidecar({ seconds: 180, hz: 50, strokesPerMin: 56 })
    const small = decimateMotionCsv(full)
    expect(small.split('\n')[0]).toBe(HEADER)
    expect(small.split('\n').filter(Boolean)).toHaveLength(1 + 180 * 10)
    expect(Math.abs(ungated(small).medianStrokesPerMin! - ungated(full).medianStrokesPerMin!)).toBeLessThan(1)
    const already = sidecar({ seconds: 60, hz: 10, strokesPerMin: 56 })
    expect(decimateMotionCsv(already, 10).trim()).toBe(already.trim())
  })

  it("finds boat motion's moving stretches after a serial-capture marker line", () => {
    const csv = trackCsv(100, 8, { marker: true })
    expect(movingRangesFromTrack(csv, 20)).toEqual([[0, 99_000]])
    expect(movingRangesFromTrack(csv)).toEqual([[0, 99_000]])
    expect(movingRangesFromTrack(trackCsv(60, 8))).toEqual([])   // shorter than the 90 s default
  })

  it('reads the tracker clock against GPS time', () => {
    expect(trackClockOffset(trackCsv(30, 8, { startMs: 5000 }))).toBe(Date.parse('2026-10-06T09:00:00Z') - 5000)
    expect(trackClockOffset('ms,ax_g\n1,2')).toBeNull()
  })

  it('gives each point the nearest window within half a step, and nothing in a gap', () => {
    const t0 = Date.parse('2026-10-06T09:00:00Z')
    const pts: { lat: number; lng: number; timestamp: Date; strokeRate?: number }[] =
      Array.from({ length: 40 }, (_, i) => ({ lat: 0, lng: 0, timestamp: new Date(t0 + i * 1000) }))
    const series = [{ ms: 10_000, strokesPerMin: 50, confidence: 0.8 }, { ms: 15_000, strokesPerMin: 54, confidence: 0.8 }]
    const out = withStrokeRate(pts, series, t0)
    expect(out[10].strokeRate).toBe(50)
    expect(out[12].strokeRate).toBe(50)
    expect(out[13].strokeRate).toBe(54)
    expect(out[17].strokeRate).toBe(54)
    expect(out[5].strokeRate).toBeUndefined()
    expect(out[30].strokeRate).toBeUndefined()
  })

  it('never replaces a stroke rate the file already carries', () => {
    const t0 = Date.parse('2026-10-06T09:00:00Z')
    const out = withStrokeRate([{ lat: 0, lng: 0, timestamp: new Date(t0), strokeRate: 30 }], [{ ms: 0, strokesPerMin: 60, confidence: 1 }], t0)
    expect(out[0].strokeRate).toBe(30)
  })

  it('gives a tracker paddle a stroke rate per effort from its motion data', async () => {
    const csv = trackCsv(300, 9, { startMs: 400_000 })
    const motion = sidecar({ seconds: 300, hz: 10, strokesPerMin: 56, startMs: 400_000 })
    const { parseTrace } = await import('@paddlesnitch/timing/parse')
    const parsed = await parseTrace('trace.csv', new TextEncoder().encode(csv).buffer as ArrayBuffer)
    if (!parsed.ok) throw new Error('fixture did not parse')
    const pts = addStrokeRate(parsed.track, csv, motion)
    expect(pts.filter(p => p.strokeRate != null).length).toBeGreaterThan(200)
    const r = analyseTrack(pts, {})
    expect(r.avgSR).toBeGreaterThan(54)
    expect(r.avgSR).toBeLessThan(58)
  })

  it('leaves the GPS-only track when the motion data is unusable', () => {
    const pts = [{ lat: 0, lng: 0, timestamp: new Date() }]
    expect(addStrokeRate(pts, 'nonsense', 'nonsense')).toBe(pts)
  })
})
