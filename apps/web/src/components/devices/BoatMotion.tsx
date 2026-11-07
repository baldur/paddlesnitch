'use client'
import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import { noMotionCopy, fmtEvenness } from '@/lib/tracker-copy'
import { eyebrowClass } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { isPhoneDeviceId } from '@paddlesnitch/core/paddles'
import { axisTicks, envelopeXLabels, histogramHalfRangeDeg } from '@/lib/boat-motion-chart'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// Boat motion from a tracker's motion data: roll, pitch, evenness, stroke rate,
// and the three charts. Shown on a tracker paddle's BOAT MOTION page
// (/paddles/[id]/motion) and on a recording that didn't become a paddle.

// Design tokens by CSS variable with a literal fallback. SVG presentation
// attributes can't use Tailwind's semantic classes, and the fallback means the
// charts stay correct even if `@theme inline` doesn't emit the variable.
const C = {
  fg: 'var(--color-fg, #e2e8f0)',
  muted: 'var(--color-muted, #94a3b8)',
  border: 'var(--color-border, #1e293b)',
  roll: 'var(--color-split, #a78bfa)',
  pitch: 'var(--color-green, #22c55e)',
  warn: 'var(--color-red, #f87171)',
}

// `deviceId`, when the page knows the tracker (or phone): a motion file that
// hasn't arrived gets a way to it, where the paddler can sync. A way there,
// not a promise: an older recording never had motion.
export default function BoatMotion({ attitude, strokeRate, deviceId }: { attitude: AttitudeReport | null; strokeRate: number | null; deviceId?: string }) {
  return (
    <>
      {!attitude?.available ? (
        <div className="rounded-control border border-border bg-surface p-4 text-base text-muted flex flex-col gap-2">
          <p className="text-fg font-medium">No boat motion for this recording.</p>
          <p>{noMotionCopy(attitude)}</p>
          {!attitude?.reason && deviceId && (
            <Link href={`/devices/${deviceId}`} className={buttonClass('secondary', 'md', 'self-start mt-1')}>
              {isPhoneDeviceId(deviceId) ? 'Open phone' : 'Open tracker'}
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Side-to-side roll" value={`${attitude.rollRmsDeg}°`} note="typical lean" />
            <Tile label="Bow-to-stern pitch" value={`${attitude.pitchRmsDeg}°`} note="typical tilt" />
            <Tile
              label="Evenness"
              value={attitude.symmetry ? fmtEvenness(attitude.symmetry.imbalancePct) : '—'}
              note={attitude.symmetry ? 'uneven' : ''}
            />
            <Tile
              label="Stroke rate"
              value={strokeRate != null ? `${Math.round(strokeRate)}` : '—'}
              note={strokeRate != null ? 'spm' : 'not measured'}
            />
          </div>

          <Panel
            title="Through the session"
            caption="The shaded band shows how far the boat rolled and pitched through the recording. Roll is the side-to-side lean, pitch the bow rising and falling."
          >
            <EnvelopeChart report={attitude} />
          </Panel>

          <Panel
            title="Stroke shape"
            caption="30 seconds of typical paddling. An even stroke crosses the centre line equally on both sides."
          >
            <ExcerptChart report={attitude} />
          </Panel>

          <Panel
            title="Where the boat spent its time"
            caption="Bars show how often the boat leaned each way. The dashed line is the same, flipped. If they match, your roll is even."
          >
            <HistogramChart report={attitude} />
          </Panel>

          <div className="rounded-control border border-border bg-surface p-4 text-sm text-muted flex flex-col gap-2">
            <p>
              <span className="text-fg">Reading this.</span> Rowing: aim for little roll, so the
              boat stays level. Kayak: the boat should rock with the stroke; what matters is that
              it rocks evenly.
            </p>
            <p>
              <span className="text-fg">What this can&apos;t tell you.</span> We can&apos;t tell port
              from starboard, and a tracker or phone mounted slightly crooked looks like a steady lean.
              {!attitude.axisConfident && ' Roll and pitch were hard to tell apart in this recording.'}
            </p>
          </div>
        </>
      )}
    </>
  )
}

// One boat-motion number, also used by the summary on the paddle page
// (BoatMotionSummary). A screen reader reads it as one thing, with the units
// spoken (mobile/contract README, Boat motion: Tiles).
export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  const spoken = value.replace(/°$/, ' degrees')
  const unit = note === 'spm' ? 'strokes per minute' : note
  return (
    <div role="group" aria-label={[label, spoken, unit].filter(Boolean).join(', ')}
      className="rounded-control border border-border bg-surface px-3 py-2 min-w-0">
      <div aria-hidden className={eyebrowClass}>{label}</div>
      <div aria-hidden className="text-fg tabular text-xl mt-0.5">{value}</div>
      {note && <div aria-hidden className="text-sm text-muted">{note}</div>}
    </div>
  )
}

function Panel({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-surface">
      <h2 className="text-base font-semibold text-fg px-4 pt-3">{title}</h2>
      <div className="px-2 pt-2">{children}</div>
      <p className="text-sm text-muted px-4 pb-3">{caption}</p>
    </section>
  )
}

/* ---------------------------------------------------------------- charts --- */

const H = 260, L = 44, R = 14, T = 14, B = 26
// A chart with a legend keeps it in a band above the plot (legend text on
// y 4–14), so the legend never covers the tallest bars or bands, which it did
// once the viewBox matched a phone's width.
const TL = 34
export const CHART_MARGIN = { L, R, T, B, TL }

// The roll/pitch legend words, shared by both charts so they sit at the same x.
// "pitch" ends at the right edge; "roll" leaves room for pitch's 18 px line key,
// its 6 px gap and 8 px before it, as Android does (#894: they touched). Plex
// Mono's characters are 0.6 em wide, so 6.6 px at 11 px.
const MONO_CH = 11 * 0.6
function legendWordX(W: number) {
  const pitch = W - R - 'pitch'.length * MONO_CH
  return { roll: pitch - (18 + 6 + 8) - 'roll'.length * MONO_CH, pitch }
}

const axes = axisTicks

// The charts draw in a viewBox as wide as they are on screen, so one unit is
// one pixel and 11 px text stays 11 px on a phone (a fixed 900-wide viewBox
// shrank it to about 4 px). 900 until measured.
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const px = Math.round(el.getBoundingClientRect().width)
      if (px > 0) setWidth(px)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function EnvelopeChart({ report }: { report: AttitudeReport }) {
  const [ref, W] = useChartWidth()
  const env = report.envelope
  if (env.length < 2) return null
  const t0 = env[0].t, t1 = env[env.length - 1].t
  // Robust bound, not the extremes: a single lurch would otherwise flatten the
  // rocking this chart exists to show. Values beyond it clamp to the edge, so an
  // outlier reads as the band touching the frame rather than vanishing.
  const maxDeg = report.plotBoundDeg ?? 10
  const clamped = env.some(b =>
    Math.abs(b.rollMin) > maxDeg || Math.abs(b.rollMax) > maxDeg ||
    Math.abs(b.pitchMin) > maxDeg || Math.abs(b.pitchMax) > maxDeg)
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R)
  const cl = (d: number) => Math.max(-maxDeg, Math.min(maxDeg, d))
  const y = (d: number) => TL + ((maxDeg - cl(d)) / (2 * maxDeg)) * (H - TL - B)

  const band = (lo: (b: typeof env[0]) => number, hi: (b: typeof env[0]) => number) =>
    `M ${env.map(b => `${x(b.t).toFixed(1)} ${y(hi(b)).toFixed(1)}`).join(' L ')} L ${[...env].reverse().map(b => `${x(b.t).toFixed(1)} ${y(lo(b)).toFixed(1)}`).join(' L ')} Z`

  const [startLabel, endLabel] = envelopeXLabels(t1 - t0)
  const words = legendWordX(W)
  return (
    <div ref={ref}>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`Roll and pitch through the session, reaching about ${maxDeg.toFixed(0)} degrees`}>
      {axes(maxDeg).map(v => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={C.border} strokeWidth={1} />
          <text x={L - 8} y={y(v) + 4} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">{v}°</text>
        </g>
      ))}
      <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke={C.muted} strokeWidth={1.2} />
      <path data-series="pitch" d={band(b => b.pitchMin, b => b.pitchMax)} fill={C.pitch} opacity={0.28} />
      <path data-series="roll" d={band(b => b.rollMin, b => b.rollMax)} fill={C.roll} opacity={0.5} />
      {/* Edges at full colour, pitch dashed, so the bands differ by more than
          colour (#855); the fills alone are under 3:1. */}
      <path data-series="pitch" d={band(b => b.pitchMin, b => b.pitchMax)} fill="none" stroke={C.pitch} strokeWidth={1.2} strokeDasharray="4 3" />
      <path data-series="roll" d={band(b => b.rollMin, b => b.rollMax)} fill="none" stroke={C.roll} strokeWidth={1.2} />
      <text x={L} y={H - 8} fill={C.muted} fontSize={11} fontFamily="var(--font-mono, monospace)">{startLabel}</text>
      <text x={W - R} y={H - 8} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">{endLabel}</text>
      {/* Legend swatches filled at 0.8, not the bands' own opacity: pitch at
          0.28 was close to invisible on the surface. Outlined like the band
          edges, pitch dashed. */}
      <g fontFamily="var(--font-mono, monospace)" fontSize={11}>
        <rect data-legend data-series="roll" x={words.roll - 14} y={4} width={10} height={10} fill={C.roll} fillOpacity={0.8} stroke={C.roll} strokeWidth={1.2} />
        <text x={words.roll} y={13} fill={C.muted}>roll</text>
        <rect data-legend data-series="pitch" x={words.pitch - 14} y={4} width={10} height={10} fill={C.pitch} fillOpacity={0.8} stroke={C.pitch} strokeWidth={1.2} strokeDasharray="4 3" />
        <text x={words.pitch} y={13} fill={C.muted}>pitch</text>
      </g>
    </svg>
    {/* Under the chart, not on its axis: it doesn't fit there on a phone. */}
    {clamped && (
      <p className="text-sm text-muted px-2 pt-1">
        A few moments went past ±{maxDeg.toFixed(0)}° and are clipped at the chart’s edge.
      </p>
    )}
    </div>
  )
}

function ExcerptChart({ report }: { report: AttitudeReport }) {
  const [ref, W] = useChartWidth()
  const ex = report.excerpt
  if (ex.length < 2) return null
  const t0 = ex[0].t, t1 = ex[ex.length - 1].t
  const maxDeg = Math.max(...ex.map(s => Math.max(Math.abs(s.roll), Math.abs(s.pitch))), 1) * 1.1
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R)
  const y = (d: number) => TL + ((maxDeg - d) / (2 * maxDeg)) * (H - TL - B)
  const line = (pick: (s: typeof ex[0]) => number) =>
    ex.map((s, i) => `${i ? 'L' : 'M'} ${x(s.t).toFixed(1)} ${y(pick(s)).toFixed(1)}`).join(' ')
  const words = legendWordX(W)

  return (
    <div ref={ref}>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label="Thirty seconds of roll and pitch at full sample rate">
      {axes(maxDeg).map(v => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={C.border} strokeWidth={1} />
          <text x={L - 8} y={y(v) + 4} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">{v}°</text>
        </g>
      ))}
      <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke={C.muted} strokeWidth={1.2} />
      {/* Pitch dashed, so the lines differ by more than colour (#855). */}
      <path data-series="pitch" d={line(s => s.pitch)} fill="none" stroke={C.pitch} strokeWidth={1.2} strokeDasharray="4 3" />
      <path data-series="roll" d={line(s => s.roll)} fill="none" stroke={C.roll} strokeWidth={1.8} />
      <text x={L} y={H - 8} fill={C.muted} fontSize={11} fontFamily="var(--font-mono, monospace)">
        {Math.round((t1 - t0) / 1000)} s at {report.sampleRateHz} Hz
      </text>
      {/* Keys match their lines; words line up with the session chart's. */}
      <g fontFamily="var(--font-mono, monospace)" fontSize={11}>
        <line data-legend data-series="roll" x1={words.roll - 24} y1={9} x2={words.roll - 6} y2={9} stroke={C.roll} strokeWidth={1.8} />
        <text x={words.roll} y={13} fill={C.muted}>roll</text>
        <line data-legend data-series="pitch" x1={words.pitch - 24} y1={9} x2={words.pitch - 6} y2={9} stroke={C.pitch} strokeWidth={1.2} strokeDasharray="4 3" />
        <text x={words.pitch} y={13} fill={C.muted}>pitch</text>
      </g>
    </svg>
    </div>
  )
}

function HistogramChart({ report }: { report: AttitudeReport }) {
  const [ref, W] = useChartWidth()
  const h = report.rollHistogram
  if (!h || h.bins.length === 0) return null
  const maxCount = Math.max(...h.bins.map(b => b.count), 1)
  const maxDeg = histogramHalfRangeDeg(h)
  const HH = 230, BB = 30
  const x = (d: number) => L + ((d + maxDeg) / (2 * maxDeg)) * (W - L - R)
  const y = (c: number) => TL + (1 - c / maxCount) * (HH - TL - BB)
  // One bin wide in degrees, less a gap, so a bar never reaches past its slot.
  const bw = (h.binWidthDeg / (2 * maxDeg)) * (W - L - R) * 0.86

  // The mirrored outline: the same distribution flipped about zero. Where it
  // parts company with the bars, that side of the stroke went further.
  const mirrored = h.bins.map(b => {
    const twin = h.bins.reduce((best, c) =>
      Math.abs(c.centreDeg + b.centreDeg) < Math.abs(best.centreDeg + b.centreDeg) ? c : best, h.bins[0])
    return { centreDeg: b.centreDeg, count: twin.count }
  })
  const outline = mirrored.map((b, i) => `${i ? 'L' : 'M'} ${x(b.centreDeg).toFixed(1)} ${y(b.count).toFixed(1)}`).join(' ')

  return (
    <div ref={ref}>
    <svg viewBox={`0 0 ${W} ${HH}`} className="w-full h-auto" role="img"
      aria-label="Distribution of boat lean, with the mirrored distribution overlaid to show evenness">
      {h.bins.map(b => (
        <rect key={b.centreDeg} x={x(b.centreDeg) - bw / 2} y={y(b.count)}
          width={bw} height={Math.max(0, HH - BB - y(b.count))} fill={C.roll} opacity={0.45} />
      ))}
      <path d={outline} fill="none" stroke={C.warn} strokeWidth={1.6} strokeDasharray="4 3" />
      <line x1={x(0)} y1={TL} x2={x(0)} y2={HH - BB} stroke={C.muted} strokeWidth={1.2} />
      <text x={x(0)} y={HH - 14} fill={C.muted} fontSize={11} textAnchor="middle" fontFamily="var(--font-mono, monospace)">level</text>
      <text x={L} y={HH - 14} fill={C.muted} fontSize={11} fontFamily="var(--font-mono, monospace)">−{maxDeg.toFixed(0)}°</text>
      <text x={W - R} y={HH - 14} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">+{maxDeg.toFixed(0)}°</text>
      <g fontFamily="var(--font-mono, monospace)" fontSize={11}>
        <rect data-legend x={L + 6} y={4} width={10} height={10} fill={C.roll} opacity={0.8} />
        <text x={L + 20} y={13} fill={C.muted}>actual</text>
        <line x1={L + 70} y1={9} x2={L + 88} y2={9} stroke={C.warn} strokeWidth={1.6} strokeDasharray="4 3" />
        <text x={L + 94} y={13} fill={C.muted}>mirrored</text>
      </g>
    </svg>
    </div>
  )
}
