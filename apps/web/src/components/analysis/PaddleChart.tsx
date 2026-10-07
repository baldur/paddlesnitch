'use client'
import { useRef } from 'react'
import type { AnalysisPoint, Segment } from '@paddlesnitch/analysis/analysis'
import { split500, fmtClock } from '@paddlesnitch/analysis/analysis'

// Pace and stroke rate through the paddle, with efforts shaded and rests in
// grey, and the replay position as a line. Tapping or dragging on it moves the
// replay (and the map's marker): the map shows where, this shows how.
//
// Hand-drawn SVG like the boat motion charts (no chart library). Colours are
// design tokens by CSS variable with literal fallbacks, since SVG presentation
// attributes can't take Tailwind classes.

const SPEED = 'var(--color-primary, #0369a1)'
const RATE = 'var(--color-split, #a78bfa)'
const GRID = 'var(--color-border, #1e293b)'
const MUTED = 'var(--color-muted, #94a3b8)'
const W = 600, H = 200, PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 6
const BUCKETS = 72

/** A centred average over neighbouring slices; a gap stays a gap. */
export function smooth(values: (number | null)[], radius = 1): (number | null)[] {
  return values.map((v, i) => {
    if (v == null) return null
    let sum = 0, n = 0
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      const w = values[j]
      if (w != null) { sum += w; n++ }
    }
    return sum / n
  })
}

/**
 * The paddle averaged into `n` equal slices of time: what a chart this size
 * can show. Per-point GPS jitter otherwise turns the line into a hedge. A
 * slice with nothing to average (a rest, no stroke rate) is null: a gap.
 */
export function bucket(points: AnalysisPoint[], n: number, value: (p: AnalysisPoint) => number | null): { t: number; v: number | null }[] {
  if (points.length < 2) return []
  const t0 = points[0].t, span = (points[points.length - 1].t - t0) || 1
  const sums = Array.from({ length: n }, () => ({ sum: 0, k: 0 }))
  for (const p of points) {
    const v = value(p)
    if (v == null) continue
    const i = Math.min(n - 1, Math.floor(((p.t - t0) / span) * n))
    sums[i].sum += v; sums[i].k++
  }
  return sums.map((b, i) => ({ t: t0 + ((i + 0.5) / n) * span, v: b.k ? b.sum / b.k : null }))
}

// The 5th to 95th percentile, so one wild slice doesn't flatten the line.
function range(values: (number | null)[]): [number, number] | null {
  const v = values.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b)
  if (v.length < 2) return null
  const lo = v[Math.floor(v.length * 0.05)], hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.95))]
  return hi > lo ? [lo, hi] : [lo * 0.9, hi * 1.1 || 1]
}

export default function PaddleChart({ points, surges, stops, cursor, onSeek }: {
  points: AnalysisPoint[]; surges: Segment[]; stops: Segment[]; cursor: number | null; onSeek: (idx: number) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  if (points.length < 2) return null
  const t0 = points[0].t, t1 = points[points.length - 1].t || 1
  const x = (t: number) => PAD_L + ((t - t0) / (t1 - t0)) * (W - PAD_L - PAD_R)
  // Moving only: a rest would drag the pace line to the floor. Slower than
  // half the paddle's median moving speed counts as stopped.
  const moving = points.map(p => p.speed).filter(v => v > 0.3).sort((a, b) => a - b)
  const floor = moving.length ? moving[Math.floor(moving.length / 2)] * 0.5 : 0.3
  const speedB = bucket(points, BUCKETS, p => (p.speed > floor ? p.speed : null))
  const rateB = bucket(points, BUCKETS, p => p.sr)
  const speed = smooth(speedB.map(b => b.v)), rate = smooth(rateB.map(b => b.v))
  const sr = range(speed), rr = range(rate)
  const yOf = (r: [number, number]) => (v: number) => PAD_T + (1 - (Math.min(r[1], Math.max(r[0], v)) - r[0]) / (r[1] - r[0])) * (H - PAD_T - PAD_B)
  const path = (vals: (number | null)[], y: (v: number) => number) => {
    let d = '', pen = false
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(speedB[i].t).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  // Pointer → the nearest point, for the replay.
  const seek = (clientX: number) => {
    const el = svg.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const t = t0 + (((clientX - box.left) / box.width) * W - PAD_L) / (W - PAD_L - PAD_R) * (t1 - t0)
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i
    onSeek(best)
  }
  const cur = cursor != null ? points[cursor] : null

  return (
    <figure className="flex flex-col gap-1" aria-label="Pace and stroke rate">
      <div className="flex gap-4 text-[10px] tracking-widest">
        <span style={{ color: SPEED }}>━ PACE /500</span>
        {rr && <span style={{ color: RATE }}>━ STROKE RATE</span>}
        <span className="text-muted">▮ EFFORTS ▮ <span className="opacity-60">RESTS</span></span>
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none cursor-crosshair select-none border border-border bg-surface"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seek(e.clientX) }}
        onPointerMove={e => { if (e.buttons) seek(e.clientX) }}>
        {surges.map((s, i) => <rect key={`s${i}`} x={x(s.fromT)} y={PAD_T} width={Math.max(1, x(s.toT) - x(s.fromT))} height={H - PAD_T - PAD_B} fill={SPEED} opacity={0.18} />)}
        {stops.map((s, i) => <rect key={`r${i}`} x={x(s.fromT)} y={PAD_T} width={Math.max(1, x(s.toT) - x(s.fromT))} height={H - PAD_T - PAD_B} fill={MUTED} opacity={0.08} />)}
        {sr && (
          <>
            {[sr[0], sr[1]].map(v => <line key={v} x1={PAD_L} x2={W - PAD_R} y1={yOf(sr)(v)} y2={yOf(sr)(v)} stroke={GRID} />)}
            <path d={path(speed, yOf(sr))} fill="none" stroke={SPEED} strokeWidth="2" />
          </>
        )}
        {rr && (
          <>
            <path d={path(rate, yOf(rr))} fill="none" stroke={RATE} strokeWidth="1.5" opacity={0.9} />
          </>
        )}
        {cur && <line x1={x(cur.t)} x2={x(cur.t)} y1={PAD_T} y2={H - PAD_B} stroke="var(--color-fg, #e2e8f0)" strokeWidth="1" />}
      </svg>
      <div className="flex justify-between gap-3 text-[11px] text-muted tabular flex-wrap">
        <span>0:00</span>
        <span>
          {sr && <span style={{ color: SPEED }}>pace {split500(sr[1])}–{split500(sr[0])} /500</span>}
          {rr && <span style={{ color: RATE }}> · rate {Math.round(rr[0])}–{Math.round(rr[1])} spm</span>}
        </span>
        <span>{fmtClock(t1 - t0)}</span>
      </div>
      <figcaption className="text-[11px] text-muted">Tap or drag on the chart to move along the paddle on the map.</figcaption>
    </figure>
  )
}
