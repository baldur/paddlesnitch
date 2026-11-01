'use client'
import { trpc } from '@/lib/trpc'
import { eyebrowClass } from '@paddlesnitch/ui/Layout'
import { Stat, cardClass } from '@paddlesnitch/ui/Card'
import type { AnalysisPoint } from '@paddlesnitch/analysis/analysis'
import { isPhonePaddle } from '@paddlesnitch/core/paddles'

// One outing recorded by two sources, side by side (docs/features/one-paddle.md,
// phase 4): both tracks over each other, how far apart the two put the paddler
// at the same moments, and stroke rate from each by the minute. For checking
// the tracker against a watch or a SpeedCoach, and for anyone who carries both.

// SVG presentation attributes can't take Tailwind classes: design tokens by
// CSS variable, with literal fallbacks.
const A_COLOUR = 'var(--color-primary-text, #38bdf8)'
const B_COLOUR = 'var(--color-split, #a78bfa)'
const GRID = 'var(--color-border, #1e293b)'
const MUTED = 'var(--color-muted, #94a3b8)'

/** What a paddle's source is called on this page. */
export function sourceName(type?: string, phone?: boolean): string {
  if (phone) return 'Phone'
  switch (type) {
    case 'device': return 'Tracker'
    case 'strava': return 'Strava'
    case 'trial': return 'Time trial'
    default: return 'File'
  }
}

export default function SameOuting({ a, b }: {
  a: { id: string; source: { type: string; deviceId?: string }; result: { points: AnalysisPoint[] } }
  b: { id: string; source: { type: string; deviceId?: string }; result: { points: AnalysisPoint[] } }
}) {
  const q = trpc.paddles.compareOuting.useQuery({ a: a.id, b: b.id }, { retry: false })
  if (!q.data?.same) return null
  const { gap, strokeRate } = q.data
  const nameA = sourceName(a.source.type, isPhonePaddle(a.source)), nameB = sourceName(b.source.type, isPhonePaddle(b.source))

  return (
    <section className="mt-6 flex flex-col gap-3" aria-label="Same outing">
      <div>
        <h2 className="text-lg font-semibold text-fg">Same outing, two recordings</h2>
        <p className="text-sm text-muted mt-1">
          These overlap in time and place, so they&apos;re one outing recorded twice. The differences are
          between the two recordings, not between two paddles.
        </p>
      </div>

      <Legend nameA={nameA} nameB={nameB} />
      <Tracks a={a.result.points} b={b.result.points} />

      {gap && (
        <div className="grid grid-cols-2 gap-2 text-sm tabular">
          <Tile label="Apart, usually" value={`${gap.medianM} m`} />
          <Tile label="Apart, at worst" value={`${gap.worstM} m`} note="95% of the time closer" />
        </div>
      )}

      {strokeRate.length >= 2 && (
        <div>
          <h3 className={`${eyebrowClass} mb-1`}>Stroke rate, minute by minute</h3>
          <StrokeRateChart rows={strokeRate} />
          <p className="text-sm text-muted mt-1">
            Where both recorded stroke rate. If one reads about half the other, it is counting one side only.
          </p>
        </div>
      )}
    </section>
  )
}

function Legend({ nameA, nameB }: { nameA: string; nameB: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span style={{ color: A_COLOUR }}>━ {nameA}</span>
      <span style={{ color: B_COLOUR }}>━ {nameB}</span>
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className={`${cardClass} p-3`}><Stat label={label} value={value} sub={note} /></div>
}

// Both tracks in one box, projected together so they line up (equirectangular
// at the mean latitude: fine at the size of a paddle).
function Tracks({ a, b }: { a: AnalysisPoint[]; b: AnalysisPoint[] }) {
  const all = [...a, ...b]
  if (all.length < 2) return null
  const lat0 = all.reduce((s, p) => s + p.lat, 0) / all.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = all.map(p => p.lng * k), ys = all.map(p => p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const W = 600, H = 300, pad = 10
  const scale = Math.min((W - 2 * pad) / (maxX - minX || 1e-9), (H - 2 * pad) / (maxY - minY || 1e-9))
  const pt = (p: AnalysisPoint) => `${(pad + (p.lng * k - minX) * scale).toFixed(1)},${(H - pad - (p.lat - minY) * scale).toFixed(1)}`
  return (
    <div className="border border-border bg-surface">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Both tracks">
        <polyline points={a.map(pt).join(' ')} fill="none" stroke={A_COLOUR} strokeWidth="2" />
        <polyline points={b.map(pt).join(' ')} fill="none" stroke={B_COLOUR} strokeWidth="2" strokeDasharray="5 3" />
      </svg>
    </div>
  )
}

function StrokeRateChart({ rows }: { rows: { minute: number; a: number; b: number }[] }) {
  const W = 600, H = 160, pad = 24
  const vals = rows.flatMap(r => [r.a, r.b])
  const lo = Math.floor(Math.min(...vals) / 10) * 10, hi = Math.ceil(Math.max(...vals) / 10) * 10 || lo + 10
  const m0 = rows[0].minute, m1 = rows[rows.length - 1].minute || m0 + 1
  const x = (m: number) => pad + ((m - m0) / Math.max(1, m1 - m0)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * pad)
  const line = (key: 'a' | 'b') => rows.map(r => `${x(r.minute).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ')
  return (
    <div className="border border-border bg-surface">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Stroke rate from each">
        {[lo, hi].map(v => (
          <g key={v}>
            <line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={2} y={y(v) + 3} fontSize="9" fill={MUTED}>{v}</text>
          </g>
        ))}
        <polyline points={line('a')} fill="none" stroke={A_COLOUR} strokeWidth="2" />
        <polyline points={line('b')} fill="none" stroke={B_COLOUR} strokeWidth="2" strokeDasharray="5 3" />
      </svg>
    </div>
  )
}
