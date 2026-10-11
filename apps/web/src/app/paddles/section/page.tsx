'use client'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDur } from '@paddlesnitch/analysis/analysis'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import LineCompare from '@/components/analysis/LineCompare'
import SectionRaceMapClient from '@/components/map/SectionRaceMapClient'
import { fmtDay } from '@paddlesnitch/core/format'

// Every pass through one section, yours and your buddies' (section-passes.ts):
// fastest first, your best + trend, and any two passes compared line against line.
export default function SectionPassesPage() {
  return <Suspense fallback={<div className="min-h-screen bg-bg" />}><Inner /></Suspense>
}

const key = (p: { owner: string; paddleId: string; n: number }) => `${p.owner}/${p.paddleId}/${p.n}`

function Inner() {
  const sp = useSearchParams()
  const src = sp.get('src'), a = sp.get('a'), b = sp.get('b'), owner = sp.get('owner') ?? undefined
  const valid = !!src && a != null && b != null
  const where = { sourceId: src ?? '', owner, aIdx: Number(a), bIdx: Number(b) }
  const q = trpc.sections.passes.useQuery(where, { enabled: valid, retry: false })
  const [picked, setPicked] = useState<string[]>([])

  const toggle = (k: string) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p.slice(-1), k]))

  if (valid && q.isPending) return <div className="min-h-screen bg-bg text-muted flex items-center justify-center text-sm">Loading…</div>
  if (!valid || !q.data) return (
    <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">{q.error?.message === 'section_too_short' ? 'That section is too short.' : 'Couldn’t load this section.'}</p>
      <Link href="/paddles" className="text-xs tracking-widest text-primary">← PADDLES</Link>
    </div>
  )

  const { passes, sectionM, startLine, finishLine, path } = q.data
  const mine = passes.filter(p => p.mine)
  const best = mine[0]
  const trend = [...mine].sort((x, y) => x.paddledAt.localeCompare(y.paddledAt))
  const chosen = picked.map(k => passes.find(p => key(p) === k)).filter(p => p != null)
  const back = owner ? `/buddies/${owner}/${src}` : `/paddles/${src}`

  return (
    <div className="min-h-screen bg-bg text-fg">
      <AppHeader breadcrumb={<Link href={back} className="tt-nav-link text-sm shrink-0">← PADDLE</Link>} />
      <div className="h-[36vh] w-full relative">
        <SectionRaceMapClient racers={[{ trackSegment: path, color: '#38bdf8', label: 'section' }]} startLine={startLine} finishLine={finishLine} />
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold tracking-widest">EVERY PASS</h1>
        <p className="text-xs text-muted mt-1">
          {(sectionM / 1000).toFixed(2)} km, <span className="text-green">start</span> to <span className="text-red">finish</span>, the same way round.
          {' '}{passes.length} pass{passes.length === 1 ? '' : 'es'}: yours and your buddies&apos;. Times include any stops.
        </p>

        {best && (
          <div className="mt-4 border-l-2 border-primary pl-3 text-sm">
            Your best: <b className="tabular">{fmtDur(best.elapsedS)}</b> ({fmtDur(best.paceS500)} /500) on {fmtDay(best.paddledAt)}
            {trend.length > 1 && <> · your last {Math.min(5, trend.length)}: <span className="tabular">{trend.slice(-5).map(p => fmtDur(p.elapsedS)).join(' → ')}</span></>}
          </div>
        )}

        <p className="text-[10px] tracking-widest text-muted mt-5 mb-2">TICK TWO TO COMPARE THEIR LINES</p>
        <div className="border-t border-border">
          {passes.map((p, i) => {
            const k = key(p)
            return (
              <label key={k} className="grid grid-cols-[auto_2rem_1fr_auto_auto_auto] gap-3 items-center py-2 border-b border-border text-sm tabular cursor-pointer min-h-[44px]">
                <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} aria-label={`Compare ${p.name} ${fmtDay(p.paddledAt)} pass ${p.n}`} />
                <span className="text-muted text-xs">{i + 1}</span>
                <span className={p.mine ? '' : 'text-split'}>{p.name} · {fmtDay(p.paddledAt)}{p.n > 1 ? ` · pass ${p.n}` : ''}</span>
                <span className="text-primary">{fmtDur(p.elapsedS)}</span>
                <span className="text-muted text-xs w-14 text-right">{fmtDur(p.paceS500)}</span>
                <span className="text-muted text-xs w-12 text-right">{p.avgSR != null ? `${Math.round(p.avgSR)} spm` : '—'}</span>
              </label>
            )
          })}
        </div>

        {chosen.length === 2 && <PassCompare where={where} a={chosen[0]} b={chosen[1]} />}
      </div>
    </div>
  )
}

type P = { owner: string; paddleId: string; n: number; name: string; paddledAt: string }

function PassCompare({ where, a, b }: { where: { sourceId: string; owner?: string; aIdx: number; bIdx: number }; a: P; b: P }) {
  const qa = trpc.sections.passLine.useQuery({ ...where, paddleOwner: a.owner, paddleId: a.paddleId, n: a.n }, { retry: false })
  const qb = trpc.sections.passLine.useQuery({ ...where, paddleOwner: b.owner, paddleId: b.paddleId, n: b.n }, { retry: false })
  if (qa.isPending || qb.isPending) return <p className="text-sm text-muted mt-4">Loading the two lines…</p>
  if (!qa.data || !qb.data) return <p className="text-sm text-muted mt-4">Couldn’t load those two passes.</p>
  const label = (p: P) => `${p.name} · ${fmtDay(p.paddledAt)}${p.n > 1 ? ` #${p.n}` : ''}`
  return <div className="mt-6"><LineCompare key={`${key(a)}|${key(b)}`} a={{ label: label(a), points: qa.data }} b={{ label: label(b), points: qb.data }} /></div>
}
