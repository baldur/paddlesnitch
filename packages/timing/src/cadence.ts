// Stroke rate from a tracker's (or phone's) recording: the track CSV and its
// motion file (`track_<stamp>_i10.csv`, or an older `_imu.csv`).
//
// The maths isn't here. It's the recorder core (recorder-core/, C), the one
// implementation that runs on the tracker, in both apps and, built for
// WebAssembly, here (docs/features/on-device-metrics.md). This file replays
// the uploaded files through it (rc_replay) and reads back the lines it
// writes (recorder_core.h, "Stroke rate"). The method, its lessons and the
// numbers it was checked against are in recorder-core/CLAUDE.md; change
// them there, never here.
//
// Replaying the files gives exactly what a device running the core worked
// out while recording (streaming = batch, checked on every fixture), so the
// number a paddler saw live and the one the site shows are the same.

import { RC_VERSION, RC_SOURCES_SHA256, RC_WASM_BASE64 } from './recorder-core-wasm'

/**
 * Which core this is: its version and the C sources it was built from. Any
 * change to the core can change a number, so cached figures key on this.
 */
export const STROKE_RATE_VERSION = `${RC_VERSION}+${RC_SOURCES_SHA256.slice(0, 12)}`

export type CadenceWindow = {
  tMs: number             // window start, on the same millis() clock as the track CSV
  cyclesPerMin: number    // what was measured
  strokesPerMin: number   // cyclesPerMin, doubled when the stroke alternates
  alternating: boolean
  confidence: number      // how strongly the stroke repeats at that rate, 0..1
}

export type CadenceReport = {
  available: boolean
  reason: string
  sampleRateHz: number | null
  rows: number
  medianStrokesPerMin: number | null
  windows: CadenceWindow[]
}

/** Stroke rate at one moment of a paddle: the centre of one short window. */
export type StrokeRatePoint = { ms: number; strokesPerMin: number; confidence: number }

/** What the motion data alone says about a paddle (#414): time with a clear stroke, about how many strokes, the rate. */
export type PaddlingFromMotion = { paddlingS: number; strokes: number; strokesPerMin: number }

/** One set of the core's 60 s windows (every 30 s). */
export type StrokeRateSet = {
  report: CadenceReport
  /** Null when no window showed a clear stroke. */
  paddling: PaddlingFromMotion | null
  /** Gaps of at least 60 s between windows with a clear stroke, [from, to] on the tracker's millis() clock. */
  rests: [number, number][]
}

export type RecordingStrokeRate = {
  /** Windows wholly inside a stretch where the GPS saw the boat moving (>= 4 km/h for >= 90 s): the recording's stroke rate. */
  moving: StrokeRateSet
  /** Every window, ungated: for a recording whose GPS failed, since it can't say where the boat moved (#414). */
  all: StrokeRateSet
  /** Through the paddle: 15 s windows every 5 s, while moving, left/right decided once. Empty for single-sided paddling. */
  series: StrokeRatePoint[]
}

// The series' step, for putting its points on the track (withStrokeRate).
export const SERIES_STEP_S = 5
const WINDOW_S = 60

let compiled: WebAssembly.Module | null = null

/**
 * The core's RC_STROKE lines for one recording, as written (no newline):
 * what recordingStrokeRate reads. Exported for the test that replays the
 * core's fixtures through this module.
 */
export function replayStrokeLines(trackCsv: string, motionCsv: string): string[] {
  compiled ??= new WebAssembly.Module(Buffer.from(RC_WASM_BASE64, 'base64'))
  const out: string[] = []
  const decoder = new TextDecoder()
  let memory: WebAssembly.Memory
  // libc's stdio comes along with snprintf, but the core never writes a file.
  const never = (name: string) => () => { throw new Error(`the recorder core called ${name}`) }
  const instance = new WebAssembly.Instance(compiled, {
    env: {
      rcw_write(stream: number, ptr: number, len: number) {
        if (stream === 3) out.push(decoder.decode(new Uint8Array(memory.buffer, ptr, len)))
      },
    },
    wasi_snapshot_preview1: { fd_close: never('fd_close'), fd_seek: never('fd_seek'), fd_write: never('fd_write') },
  })
  const core = instance.exports as {
    memory: WebAssembly.Memory; _initialize(): void
    rcw_alloc(n: number): number; rcw_replay(t: number, tn: number, m: number, mn: number): void
  }
  memory = core.memory
  core._initialize()
  const encoder = new TextEncoder()
  const put = (s: string): [number, number] => {
    const bytes = encoder.encode(s)
    const p = core.rcw_alloc(bytes.length)
    new Uint8Array(core.memory.buffer, p, bytes.length).set(bytes)
    return [p, bytes.length]
  }
  const [t, tn] = put(trackCsv)
  const [m, mn] = put(motionCsv)
  core.rcw_replay(t, tn, m, mn)
  // The instance (and its memory) goes with this call: nothing to free.
  return out.join('').split('\n').filter(Boolean)
}

/** What each of the core's reasons (recorder_core.h, "reason:") says; cadence.test.ts checks every one has words. */
export const STROKE_RATE_REASONS: Record<string, (hz: number, windows: number) => string> = {
  ok: (hz, n) => `Derived from ${n} window${n === 1 ? '' : 's'} of ${WINDOW_S}s at ${Math.round(hz)} Hz.`,
  too_few_samples: () => 'Motion file has too few samples to derive cadence.',
  too_slow: hz => `Motion data is sampled at ${hz > 0 ? hz.toFixed(1) : '?'} Hz — too slow for a 0.5–2 Hz stroke.`,
  no_rhythm: () => 'No window showed a clear repeating stroke pattern — the device may have been stationary, or carried somewhere the stroke does not reach it.',
}

/**
 * Stroke rate for a recording, from its track CSV and motion file as
 * uploaded. A recording with no track (or one that doesn't parse) still has
 * `all`; `moving` and `series` need the track to say the boat moved.
 */
export function recordingStrokeRate(trackCsv: string, motionCsv: string): RecordingStrokeRate {
  const windows: Record<string, CadenceWindow[]> = { moving: [], all: [] }
  const rests: Record<string, [number, number][]> = { moving: [], all: [] }
  const sessions: Record<string, string[]> = {}
  const points: StrokeRatePoint[] = []
  let rows = 0, hz = 0, seriesOk = false
  for (const line of replayStrokeLines(trackCsv, motionCsv)) {
    const f = line.split(',')
    switch (f[0]) {
      case 'window':
        if (f[1] in windows) {
          windows[f[1]].push({ tMs: Number(f[2]), cyclesPerMin: Number(f[3]), strokesPerMin: Number(f[4]), alternating: f[5] === '1', confidence: Number(f[6]) })
        }
        break
      case 'point': points.push({ ms: Number(f[1]), strokesPerMin: Number(f[2]), confidence: Number(f[3]) }); break
      case 'rest': rests[f[1]]?.push([Number(f[2]), Number(f[3])]); break
      case 'motion': rows = Number(f[1]); hz = Number(f[2]); break
      case 'session': sessions[f[1]] = f; break
      case 'series': seriesOk = f[1] === '1'; break
    }
  }
  const set = (name: 'moving' | 'all'): StrokeRateSet => {
    // session,<set>,<available>,<reason>,<windows>,<median>,<paddling s>,<strokes>
    const s = sessions[name]
    if (!s) throw new Error(`the recorder core wrote no ${name} session line`)
    const available = s[2] === '1'
    const median = Number(s[5])
    const report: CadenceReport = {
      available,
      // A reason this code doesn't know yet (a newer core) gets plain words, never the raw code.
      reason: (STROKE_RATE_REASONS[s[3]] ?? (() => "Couldn't work out a stroke rate from this motion file."))(hz, Number(s[4])),
      sampleRateHz: hz > 0 ? hz : null,
      rows,
      medianStrokesPerMin: available ? median : null,
      windows: available ? windows[name] : [],
    }
    return {
      report,
      paddling: available ? { paddlingS: Number(s[6]), strokes: Number(s[7]), strokesPerMin: median } : null,
      rests: available ? rests[name] : [],
    }
  }
  return { moving: set('moving'), all: set('all'), series: seriesOk ? points : [] }
}

/** One motion sample of a sidecar: accelerometer in g, gyroscope in deg/s. */
export type MotionSample = { ms: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }

/** Parses the sidecar CSV. Tolerates the header being present or absent. */
export function parseMotionCsv(csv: string): MotionSample[] {
  const out: MotionSample[] = []
  for (const line of csv.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const p = t.split(',')
    if (p.length < 7) continue
    const ms = Number(p[0])
    if (!Number.isFinite(ms)) continue   // the header row lands here
    const v = p.slice(1, 7).map(Number)
    if (v.some(n => !Number.isFinite(n))) continue
    out.push({ ms, ax: v[0], ay: v[1], az: v[2], gx: v[3], gy: v[4], gz: v[5] })
  }
  out.sort((a, b) => a.ms - b.ms)
  return out
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Milliseconds to add to the tracker's millis() clock to get UTC, from the
 * track CSV rows that carry both (`ms` and the GPS `timestamp`). The median
 * absorbs the sub-second jitter of when each row was written. Null when the
 * file has no such rows.
 */
export function trackClockOffset(csv: string): number | null {
  const lines = csv.split(/\r?\n/)
  const hi = lines.findIndex(l => /(^|,)\s*ms\s*,/i.test(l))
  if (hi < 0) return null
  const head = lines[hi].split(',').map(h => h.trim().toLowerCase())
  const msI = head.indexOf('ms'), tI = head.indexOf('timestamp')
  if (msI < 0 || tI < 0) return null
  const offsets: number[] = []
  for (const line of lines.slice(hi + 1)) {
    const p = line.split(',')
    const ms = Number(p[msI]), t = Date.parse(p[tI] ?? '')
    if (p[tI] && Number.isFinite(ms) && Number.isFinite(t)) offsets.push(t - ms)
  }
  return median(offsets)
}

/**
 * Puts the stroke rate series onto the track's points: each point gets the
 * value of the window centred nearest it, within half a step. Points in a gap
 * (a rest, an unclear stretch) get none. A rate the source file already
 * carries is never replaced.
 */
export function withStrokeRate<T extends { timestamp: Date; strokeRate?: number }>(
  track: T[], series: StrokeRatePoint[], clockOffsetMs: number, stepS = SERIES_STEP_S,
): T[] {
  if (series.length === 0) return track
  const half = (stepS * 1000) / 2
  let j = 0
  return track.map(p => {
    if (p.strokeRate != null) return p
    const ms = p.timestamp.getTime() - clockOffsetMs
    while (j + 1 < series.length && Math.abs(series[j + 1].ms - ms) <= Math.abs(series[j].ms - ms)) j++
    return Math.abs(series[j].ms - ms) <= half ? { ...p, strokeRate: series[j].strokesPerMin } : p
  })
}

/**
 * Thins a sidecar to every Nth line, about `targetHz`, keeping the header:
 * the motion file trackers uploaded from 13 to 17 Sep 2026 (#234), before
 * firmware thinned by time (an 80 ms gate, #242). Only the performance test
 * account uses it, to upload such a file. Never use it to make a file for
 * stroke rate: the tracker's samples stall, so every Nth sample isn't even
 * in time (recorder-core/CLAUDE.md, "The sample rate").
 */
export function decimateMotionCsv(csv: string, targetHz = 10): string {
  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) return ''
  const head = Number(lines[0].split(',')[0])
  const hasHeader = !Number.isFinite(head)
  const header = hasHeader ? lines[0] : null
  const body = hasHeader ? lines.slice(1) : lines

  const ms = (l: string) => Number(l.split(',')[0])
  const deltas: number[] = []
  for (let i = 1; i < Math.min(body.length, 2000); i++) {
    const d = ms(body[i]) - ms(body[i - 1])
    if (Number.isFinite(d) && d > 0) deltas.push(d)
  }
  const step = median(deltas)
  const fs = step && step > 0 ? 1000 / step : targetHz
  const factor = Math.max(1, Math.round(fs / targetHz))

  const kept = factor > 1 ? body.filter((_, i) => i % factor === 0) : body
  return [...(header ? [header] : []), ...kept].join('\n') + '\n'
}
