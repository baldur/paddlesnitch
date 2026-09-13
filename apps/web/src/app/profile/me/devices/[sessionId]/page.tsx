'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import type { DeviceSessionMeta } from '@/lib/devices'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'

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

const fmtDate = (iso?: string) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(0, 16) }
}

export default function DeviceSessionPage() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = params?.sessionId ?? ''
  const [meta, setMeta] = useState<DeviceSessionMeta | null | 'missing'>(null)
  const [attitude, setAttitude] = useState<AttitudeReport | null>(null)
  const [cadence, setCadence] = useState<CadenceReport | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // The session list is already owner-filtered, and it is where the
        // deviceId comes from — so the URL can carry just the session id.
        const listRes = await fetch('/api/account/devices/sessions')
        const list: { sessions?: DeviceSessionMeta[] } = listRes.ok ? await listRes.json() : {}
        const found = (list.sessions ?? []).find(s => s.sessionId === sessionId)
        if (cancelled) return
        if (!found) { setMeta('missing'); setState('ready'); return }
        setMeta(found)

        const res = await fetch(`/api/account/devices/sessions/${sessionId}?deviceId=${encodeURIComponent(found.deviceId)}`)
        const d = await res.json()
        if (cancelled) return
        setAttitude(d.attitude ?? null)
        setCadence(d.cadence ?? null)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/profile/me/devices" className="tt-nav-link text-sm shrink-0">← DEVICE DATA</Link>} />
      <div className="flex-1 px-4 py-8 max-w-4xl mx-auto w-full flex flex-col gap-6">
        {state === 'loading' && <LoadingState label="Reading session" />}
        {state === 'error' && <p className="text-sm text-red">Could not read this session.</p>}

        {state === 'ready' && meta === 'missing' && (
          <p className="text-sm text-muted">
            No such session, or it isn&apos;t yours.{' '}
            <Link href="/profile/me/devices" className="text-primary">Back to device data</Link>.
          </p>
        )}

        {state === 'ready' && meta && meta !== 'missing' && (
          <>
            <div>
              <h1 className="text-2xl font-bold text-fg tracking-wide">Boat motion</h1>
              <p className="text-sm text-muted mt-1 tabular">
                {meta.filename} · {fmtDate(meta.startedAt ?? meta.uploadedAt)} · {meta.deviceId}
              </p>
            </div>

            {!attitude?.available ? (
              <div className="border border-border bg-surface px-4 py-3 text-sm text-muted leading-relaxed">
                <p className="text-fg mb-1">No motion data for this session yet.</p>
                <p>
                  {attitude?.reason
                    ?? 'Roll and pitch come from the tracker’s motion sidecar, which uploads alongside the track. Sessions recorded before that shipped have no sidecar and never will.'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Tile label="Roll (rms)" value={`${attitude.rollRmsDeg}°`} note="side to side" />
                  <Tile label="Pitch (rms)" value={`${attitude.pitchRmsDeg}°`} note="bow / stern" />
                  <Tile
                    label="Rock evenness"
                    value={attitude.symmetry ? `${Math.abs(attitude.symmetry.imbalancePct).toFixed(0)}%` : '—'}
                    note={attitude.symmetry ? 'off even' : ''}
                  />
                  <Tile
                    label="Stroke rate"
                    value={cadence?.available ? `${cadence.medianStrokesPerMin}` : '—'}
                    note={cadence?.available ? 'spm' : 'no cadence'}
                  />
                </div>

                <Panel
                  title="Through the session"
                  caption="The band is the full range the boat swung through in each moment, not a sampled line — at this zoom a single sample per pixel would draw a wave that never happened. Roll is the side-to-side lean, pitch the bow rising and falling."
                >
                  <EnvelopeChart report={attitude} />
                </Panel>

                <Panel
                  title="Stroke shape"
                  caption={`Thirty seconds at full rate, taken from the most representative part of the session. This is what one stroke actually looks like — a smooth even rock crosses the centre line symmetrically.`}
                >
                  <ExcerptChart report={attitude} />
                </Panel>

                <Panel
                  title="Where the boat spent its time"
                  caption="Solid bars are the real distribution of lean. The outline is that same distribution mirrored — if your rocking is even, the two match. Where the outline sticks out past the bars, that side went further."
                >
                  <HistogramChart report={attitude} />
                </Panel>

                <div className="border border-border bg-surface px-4 py-3 text-xs text-muted leading-relaxed flex flex-col gap-2">
                  <p>
                    <span className="text-fg">Reading this.</span> Rowing wants roll near zero — the hull
                    should stay level. Kayaking is the opposite: the boat is meant to rock with the
                    stroke, so what matters is that it rocks <em>evenly</em>. A big roll is only a
                    fault if it&apos;s lopsided.
                  </p>
                  <p>
                    <span className="text-fg">What this can&apos;t tell you.</span> Which side is port
                    and which starboard isn&apos;t recoverable — there&apos;s no magnetometer, so
                    there&apos;s no heading. And a constant lean can&apos;t be separated from the
                    tracker being mounted a few degrees off, so everything here is measured about this
                    session&apos;s own neutral.
                    {!attitude.axisConfident && ' Roll and pitch were also too similar in this session to separate reliably, so treat which is which with caution.'}
                  </p>
                  <p className="tabular">{attitude.reason}</p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-border bg-surface px-3 py-2">
      <div className="text-[9px] text-muted tracking-widest uppercase">{label}</div>
      <div className="text-fg tabular text-xl mt-0.5">{value}</div>
      {note && <div className="text-[10px] text-muted mt-0.5">{note}</div>}
    </div>
  )
}

function Panel({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-surface">
      <h2 className="text-[10px] text-muted tracking-[0.2em] uppercase px-4 pt-3">{title}</h2>
      <div className="px-2 pt-2">{children}</div>
      <p className="text-[11px] text-muted leading-relaxed px-4 pb-3">{caption}</p>
    </section>
  )
}

/* ---------------------------------------------------------------- charts --- */

const W = 900, H = 260, L = 44, R = 14, T = 14, B = 26

function axes(maxDeg: number) {
  const step = maxDeg > 12 ? 5 : maxDeg > 6 ? 3 : 2
  const ticks: number[] = []
  for (let v = -Math.ceil(maxDeg / step) * step; v <= maxDeg; v += step) ticks.push(v)
  return ticks
}

function EnvelopeChart({ report }: { report: AttitudeReport }) {
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
  const y = (d: number) => T + ((maxDeg - cl(d)) / (2 * maxDeg)) * (H - T - B)

  const band = (lo: (b: typeof env[0]) => number, hi: (b: typeof env[0]) => number) =>
    `M ${env.map(b => `${x(b.t).toFixed(1)} ${y(hi(b)).toFixed(1)}`).join(' L ')} L ${[...env].reverse().map(b => `${x(b.t).toFixed(1)} ${y(lo(b)).toFixed(1)}`).join(' L ')} Z`

  const mins = Math.round((t1 - t0) / 60000)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`Roll and pitch through the session, reaching about ${maxDeg.toFixed(0)} degrees`}>
      {axes(maxDeg).map(v => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={C.border} strokeWidth={1} />
          <text x={L - 8} y={y(v) + 4} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">{v}°</text>
        </g>
      ))}
      <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke={C.muted} strokeWidth={1.2} />
      <path d={band(b => b.pitchMin, b => b.pitchMax)} fill={C.pitch} opacity={0.28} />
      <path d={band(b => b.rollMin, b => b.rollMax)} fill={C.roll} opacity={0.5} />
      <text x={L} y={H - 8} fill={C.muted} fontSize={11} fontFamily="var(--font-mono, monospace)">0 min</text>
      {clamped && (
        <text x={(L + W - R) / 2} y={H - 8} fill={C.muted} fontSize={11} textAnchor="middle" fontFamily="var(--font-mono, monospace)">
          a few moments went past ±{maxDeg.toFixed(0)}° and are clipped here
        </text>
      )}
      <text x={W - R} y={H - 8} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">{mins} min</text>
      <g fontFamily="var(--font-mono, monospace)" fontSize={11}>
        <rect x={W - R - 108} y={T + 2} width={10} height={10} fill={C.roll} opacity={0.5} />
        <text x={W - R - 94} y={T + 11} fill={C.muted}>roll</text>
        <rect x={W - R - 58} y={T + 2} width={10} height={10} fill={C.pitch} opacity={0.28} />
        <text x={W - R - 44} y={T + 11} fill={C.muted}>pitch</text>
      </g>
    </svg>
  )
}

function ExcerptChart({ report }: { report: AttitudeReport }) {
  const ex = report.excerpt
  if (ex.length < 2) return null
  const t0 = ex[0].t, t1 = ex[ex.length - 1].t
  const maxDeg = Math.max(...ex.map(s => Math.max(Math.abs(s.roll), Math.abs(s.pitch))), 1) * 1.1
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R)
  const y = (d: number) => T + ((maxDeg - d) / (2 * maxDeg)) * (H - T - B)
  const line = (pick: (s: typeof ex[0]) => number) =>
    ex.map((s, i) => `${i ? 'L' : 'M'} ${x(s.t).toFixed(1)} ${y(pick(s)).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label="Thirty seconds of roll and pitch at full sample rate">
      {axes(maxDeg).map(v => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={C.border} strokeWidth={1} />
          <text x={L - 8} y={y(v) + 4} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">{v}°</text>
        </g>
      ))}
      <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke={C.muted} strokeWidth={1.2} />
      <path d={line(s => s.pitch)} fill="none" stroke={C.pitch} strokeWidth={1.2} opacity={0.7} />
      <path d={line(s => s.roll)} fill="none" stroke={C.roll} strokeWidth={1.8} />
      <text x={L} y={H - 8} fill={C.muted} fontSize={11} fontFamily="var(--font-mono, monospace)">
        {Math.round((t1 - t0) / 1000)} s at {report.sampleRateHz} Hz
      </text>
    </svg>
  )
}

function HistogramChart({ report }: { report: AttitudeReport }) {
  const h = report.rollHistogram
  if (!h || h.bins.length === 0) return null
  const maxCount = Math.max(...h.bins.map(b => b.count), 1)
  const maxDeg = Math.max(...h.bins.map(b => Math.abs(b.centreDeg)), 1)
  const HH = 230, BB = 30
  const x = (d: number) => L + ((d + maxDeg) / (2 * maxDeg)) * (W - L - R)
  const y = (c: number) => T + (1 - c / maxCount) * (HH - T - BB)
  const bw = ((W - L - R) / h.bins.length) * 0.86

  // The mirrored outline: the same distribution flipped about zero. Where it
  // parts company with the bars, that side of the stroke went further.
  const mirrored = h.bins.map(b => {
    const twin = h.bins.reduce((best, c) =>
      Math.abs(c.centreDeg + b.centreDeg) < Math.abs(best.centreDeg + b.centreDeg) ? c : best, h.bins[0])
    return { centreDeg: b.centreDeg, count: twin.count }
  })
  const outline = mirrored.map((b, i) => `${i ? 'L' : 'M'} ${x(b.centreDeg).toFixed(1)} ${y(b.count).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${HH}`} className="w-full h-auto" role="img"
      aria-label="Distribution of boat lean, with the mirrored distribution overlaid to show evenness">
      {h.bins.map(b => (
        <rect key={b.centreDeg} x={x(b.centreDeg) - bw / 2} y={y(b.count)}
          width={bw} height={Math.max(0, HH - BB - y(b.count))} fill={C.roll} opacity={0.45} />
      ))}
      <path d={outline} fill="none" stroke={C.warn} strokeWidth={1.6} strokeDasharray="4 3" />
      <line x1={x(0)} y1={T} x2={x(0)} y2={HH - BB} stroke={C.muted} strokeWidth={1.2} />
      <text x={x(0)} y={HH - 14} fill={C.muted} fontSize={11} textAnchor="middle" fontFamily="var(--font-mono, monospace)">level</text>
      <text x={L} y={HH - 14} fill={C.muted} fontSize={11} fontFamily="var(--font-mono, monospace)">−{maxDeg.toFixed(0)}°</text>
      <text x={W - R} y={HH - 14} fill={C.muted} fontSize={11} textAnchor="end" fontFamily="var(--font-mono, monospace)">+{maxDeg.toFixed(0)}°</text>
      <g fontFamily="var(--font-mono, monospace)" fontSize={11}>
        <rect x={L + 6} y={T} width={10} height={10} fill={C.roll} opacity={0.45} />
        <text x={L + 20} y={T + 9} fill={C.muted}>actual</text>
        <line x1={L + 70} y1={T + 5} x2={L + 88} y2={T + 5} stroke={C.warn} strokeWidth={1.6} strokeDasharray="4 3" />
        <text x={L + 94} y={T + 9} fill={C.muted}>mirrored</text>
      </g>
    </svg>
  )
}
