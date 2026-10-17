'use client'
import { useEffect, useMemo, useState } from 'react'
import type { AnalysisPoint } from '@paddlesnitch/analysis/analysis'
import { compareLines, compareSection, lineSummary, replayAt, replayLength, type LineCompare as Cmp } from '@paddlesnitch/analysis/line-compare'
import CompareMapClient from '@/components/map/CompareMapClient'
import { A_LINE, B_LINE } from '@/components/map/compare-colours'

type LL = [number, number]
type Side = { label: string; points: AnalysisPoint[] }

// The whole paddles are compared when B went the same way round as A for at
// least this share of either; otherwise a stretch has to be picked.
const WHOLE_MIN_SHARE = 0.6

const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// Two paddles on one map: where their lines differ and who gained where
// (docs/features/buddies-and-compare.md, phase 1).
export default function LineCompare({ a, b }: { a: Side; b: Side }) {
  const [picks, setPicks] = useState<number[]>([])
  const [secs, setSecs] = useState(0)
  const [playing, setPlaying] = useState(false)

  const whole = useMemo(() => compareLines(a.points, b.points), [a.points, b.points])
  const aLen = whole?.ref[whole.ref.length - 1]?.atM ?? 0
  const wholeOk = !!whole && (whole.overlapShare >= WHOLE_MIN_SHARE || whole.toM - whole.fromM >= WHOLE_MIN_SHARE * aLen)
  const section = useMemo(() => (picks.length === 2 ? compareSection(a.points, b.points, picks[0], picks[1]) : null), [a.points, b.points, picks])

  // With no stretch picked: the longest stretch both paddled the same way,
  // which is the whole paddles when it covers most of them.
  const active: { c: Cmp; pa: AnalysisPoint[]; pb: AnalysisPoint[] } | null =
    section?.ok ? { c: section.compare, pa: section.aPass, pb: section.bPass }
      : picks.length === 0 && whole ? { c: whole, pa: a.points, pb: b.points } : null
  const length = active ? replayLength(active.c) : 0

  // Replay at 20x: a 30-minute stretch plays in 90 seconds.
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setSecs(s => { if (s + 2 >= length) { setPlaying(false); return length } return s + 2 }), 100)
    return () => clearInterval(id)
  }, [playing, length])

  const boats = active ? replayAt(active.pa, active.pb, active.c, secs) : { a: null, b: null }
  const widest = active ? [...active.c.bins].filter(x => x.gapM >= 10).sort((x, y) => y.gapM - x.gapM)[0] : undefined
  const highlight: LL[] | undefined = widest && active
    ? active.c.ref.filter(r => r.atM >= widest.fromM - 25 && r.atM <= widest.toM + 25).map(r => [r.lat, r.lng])
    : undefined

  const pick = ([lat, lng]: LL) => {
    let best = -1, bestD = Infinity
    a.points.forEach((p, i) => { const d = Math.hypot((p.lat - lat) * 110_540, (p.lng - lng) * 69_000); if (d < bestD) { bestD = d; best = i } })
    if (bestD > 80) return   // a tap must be on (or near) the blue line
    choose(picks.length >= 2 ? [best] : [...picks, best])
  }
  // A new stretch starts its replay from the beginning.
  const choose = (next: number[]) => { setPicks(next); setSecs(0); setPlaying(false) }

  let message: string | null = null
  if (picks.length === 1) message = 'Now tap where the stretch ends.'
  else if (section && !section.ok) message = {
    too_short: 'That stretch is under 200 m. Pick points further apart.',
    a_missed: `Couldn't follow ${a.label} through that stretch. Pick other points.`,
    b_missed: `${b.label} didn't paddle that stretch in the same direction.`,
    no_shared_line: `${b.label} didn't paddle that stretch in the same direction.`,
  }[section.reason]
  else if (picks.length === 0 && !whole) message = `These two didn't paddle the same water in the same direction. Tap two points on the blue line to compare a stretch you both paddled.`

  return (
    <section className="mb-6" aria-label="On the water">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs tracking-widest text-muted">ON THE WATER</h2>
        <div className="text-xs flex gap-3">
          <span style={{ color: A_LINE }}>━ {a.label}</span>
          <span style={{ color: B_LINE }}>┅ {b.label}</span>
        </div>
      </div>
      <div className="h-80 border border-border">
        <CompareMapClient
          a={a.points.map(p => [p.lat, p.lng])} b={b.points.map(p => [p.lat, p.lng])}
          boatA={boats.a ? [boats.a.lat, boats.a.lng] : null} boatB={boats.b ? [boats.b.lat, boats.b.lng] : null}
          highlight={highlight}
          gates={section?.ok ? [section.startLine, section.finishLine] : undefined}
          picks={picks.map(i => [a.points[i].lat, a.points[i].lng])}
          onPick={pick}
        />
      </div>

      {active && (
        <div className="flex items-center gap-3 mt-2">
          <button type="button" onClick={() => { if (secs >= length) setSecs(0); setPlaying(p => !p) }}
            className="px-3 py-1.5 bg-primary text-white text-xs tracking-widest">{playing ? 'PAUSE' : 'REPLAY'}</button>
          <input type="range" min={0} max={Math.max(1, Math.round(length))} value={Math.round(secs)} aria-label="Replay position"
            onChange={e => { setPlaying(false); setSecs(Number(e.target.value)) }} className="flex-1" />
          <span className="text-xs text-muted tabular w-12 text-right">{fmtSecs(secs)}</span>
        </div>
      )}

      {active && (
        <div className="mt-3 border-l-2 border-primary pl-3 text-sm text-fg flex flex-col gap-1">
          <p className="text-[10px] tracking-widest text-muted">
            {section?.ok ? 'THE STRETCH YOU PICKED' : wholeOk ? 'WHOLE PADDLES'
              : `THE LONGEST STRETCH YOU BOTH PADDLED THE SAME WAY (${((active.c.toM - active.c.fromM) / 1000).toFixed(1)} KM)`}
          </p>
          {lineSummary(active.c, a.label, b.label).map(s => <p key={s}>{s}</p>)}
          <p className="text-xs text-muted">Moving time only: rests don&apos;t count.{widest ? ' The yellow mark is where the lines were furthest apart.' : ''}</p>
        </div>
      )}
      {message && <p className="mt-3 text-sm text-muted">{message}</p>}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        {picks.length === 0 && whole && <span>Tap two points on the blue line to compare one stretch.</span>}
        {picks.length > 0 && <button type="button" onClick={() => choose([])} className="text-primary-text tracking-widest">WHOLE PADDLES</button>}
      </div>
    </section>
  )
}
