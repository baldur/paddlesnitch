'use client'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { fmtDur } from '@paddlesnitch/analysis/analysis'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import LineCompare from '@/components/analysis/LineCompare'
import SectionRaceMapClient from '@/components/map/SectionRaceMapClient'
import { fmtDay } from '@paddlesnitch/core/format'

// Every pass through one section, yours and your buddies' (section-passes.ts):
// fastest first, your best + trend, and any two passes compared line against
// line. The section is picked on a paddle (?src=&a=&b=[&owner=], with SAVE) or
// one you saved (?id=, #435).
export default function SectionPassesPage() {
  return <Suspense fallback={<div className="min-h-screen bg-bg" />}><Inner /></Suspense>
}

type Where = { sourceId: string; owner?: string; aIdx: number; bIdx: number } | { sectionId: string }
const key = (p: { owner: string; paddleId: string; n: number }) => `${p.owner}/${p.paddleId}/${p.n}`

function Inner() {
  const sp = useSearchParams()
  const sectionId = sp.get('id')
  const src = sp.get('src'), a = sp.get('a'), b = sp.get('b'), owner = sp.get('owner') ?? undefined
  const valid = !!sectionId || (!!src && a != null && b != null)
  const where: Where = sectionId ? { sectionId } : { sourceId: src ?? '', owner, aIdx: Number(a), bIdx: Number(b) }
  const q = trpc.sections.passes.useQuery(where, { enabled: valid, retry: false })
  const [picked, setPicked] = useState<string[]>([])

  const toggle = (k: string) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p.slice(-1), k]))

  if (valid && q.isPending) return <div className="min-h-screen bg-bg text-muted flex items-center justify-center text-sm">Loading…</div>
  if (!valid || !q.data) return (
    <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">{q.error?.message === 'section_too_short' ? 'That section is too short.' : sectionId ? 'We can’t find this section.' : 'Couldn’t load this section.'}</p>
      <Link href={sectionId ? '/paddles/sections' : '/paddles'} className="text-xs tracking-widest text-primary">{sectionId ? '← SECTIONS' : '← PADDLES'}</Link>
    </div>
  )

  const { passes, sectionM, startLine, finishLine, path, saved } = q.data
  const mine = passes.filter(p => p.mine)
  const best = mine[0]
  const trend = [...mine].sort((x, y) => x.paddledAt.localeCompare(y.paddledAt))
  const chosen = picked.map(k => passes.find(p => key(p) === k)).filter(p => p != null)
  const back = saved ? { href: '/paddles/sections', label: '← SECTIONS' }
    : { href: owner ? `/buddies/${owner}/${src}` : `/paddles/${src}`, label: '← PADDLE' }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <AppHeader breadcrumb={<Link href={back.href} className="tt-nav-link text-sm shrink-0">{back.label}</Link>} />
      <div className="h-[36vh] w-full relative">
        <SectionRaceMapClient racers={[{ trackSegment: path, color: '#38bdf8', label: 'section' }]} startLine={startLine} finishLine={finishLine} />
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold tracking-widest">{saved ? saved.name.toUpperCase() : 'EVERY PASS'}</h1>
        <p className="text-xs text-muted mt-1">
          {(sectionM / 1000).toFixed(2)} km, <span className="text-green">start</span> to <span className="text-red">finish</span>, the same way round.
          {' '}{passes.length} pass{passes.length === 1 ? '' : 'es'}: yours and your buddies&apos;. Times include any stops.
        </p>

        {saved ? <ManageSaved id={saved.id} name={saved.name} /> : <SaveSection where={where as Extract<Where, { sourceId: string }>} />}

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

// Save a picked section with a name, to come back to (#435).
function SaveSection({ where }: { where: { sourceId: string; owner?: string; aIdx: number; bIdx: number } }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const save = trpc.sections.save.useMutation({ onSuccess: r => router.push(`/paddles/section?id=${r.id}`) })
  return (
    <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) save.mutate({ ...where, name }) }}>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Name it, e.g. Bridge to the lock" aria-label="Section name"
        className="flex-1 bg-surface border border-border px-3 py-2 text-sm" />
      <button type="submit" disabled={!name.trim() || save.isPending} className="px-4 py-2 bg-primary text-white text-xs tracking-widest disabled:opacity-40">
        {save.isPending ? 'SAVING…' : 'SAVE'}
      </button>
      {save.isError && <p className="text-xs text-red self-center">{save.error.message === 'too_many_sections' ? 'Couldn’t save: you have 200 sections. Remove one first.' : 'Couldn’t save it. Please try again.'}</p>}
    </form>
  )
}

function ManageSaved({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [editing, setEditing] = useState<string | null>(null)
  const rename = trpc.sections.rename.useMutation({ onSuccess: () => { setEditing(null); void utils.sections.passes.invalidate() } })
  const remove = trpc.sections.remove.useMutation({ onSuccess: () => router.push('/paddles/sections') })
  if (editing != null) return (
    <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (editing.trim()) rename.mutate({ sectionId: id, name: editing }) }}>
      <input value={editing} onChange={e => setEditing(e.target.value)} maxLength={60} aria-label="Section name" className="flex-1 bg-surface border border-border px-3 py-2 text-sm" />
      <button type="submit" disabled={!editing.trim() || rename.isPending} className="px-4 py-2 bg-primary text-white text-xs tracking-widest disabled:opacity-40">{rename.isPending ? 'SAVING…' : 'SAVE'}</button>
      <button type="button" onClick={() => setEditing(null)} className="px-3 py-2 text-xs tracking-widest text-muted">CANCEL</button>
    </form>
  )
  return (
    <div className="mt-3 flex gap-4 text-[10px] tracking-widest">
      <button type="button" onClick={() => setEditing(name)} className="text-primary">RENAME</button>
      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate({ sectionId: id })} className="text-red">{remove.isPending ? 'REMOVING…' : 'REMOVE'}</button>
    </div>
  )
}

type P = { owner: string; paddleId: string; n: number; name: string; paddledAt: string }

function PassCompare({ where, a, b }: { where: Where; a: P; b: P }) {
  const qa = trpc.sections.passLine.useQuery({ where, paddleOwner: a.owner, paddleId: a.paddleId, n: a.n }, { retry: false })
  const qb = trpc.sections.passLine.useQuery({ where, paddleOwner: b.owner, paddleId: b.paddleId, n: b.n }, { retry: false })
  if (qa.isPending || qb.isPending) return <p className="text-sm text-muted mt-4">Loading the two lines…</p>
  if (!qa.data || !qb.data) return <p className="text-sm text-muted mt-4">Couldn’t load those two passes.</p>
  const label = (p: P) => `${p.name} · ${fmtDay(p.paddledAt)}${p.n > 1 ? ` #${p.n}` : ''}`
  return <div className="mt-6"><LineCompare key={`${key(a)}|${key(b)}`} a={{ label: label(a), points: qa.data }} b={{ label: label(b), points: qb.data }} /></div>
}
