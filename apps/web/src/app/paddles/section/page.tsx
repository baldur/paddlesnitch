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
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { inputClass } from '@paddlesnitch/ui/Form'
import { EmptyState } from '@paddlesnitch/ui/Card'
import LoadingState from '@/components/LoadingState'

// Every pass through one section, yours and your buddies' (section-passes.ts):
// fastest first, your best + trend, and any two passes compared line against
// line. The section is picked on a paddle (?src=&a=&b=[&owner=], with SAVE) or
// one you saved (?id=, #435).
export default function SectionPassesPage() {
  return <Suspense fallback={<main className="flex-1 flex"><LoadingState label="Loading" /></main>}><Inner /></Suspense>
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

  if (valid && q.isPending) return <main className="flex-1 flex"><LoadingState label="Loading" /></main>
  if (!valid || !q.data) {
    const backTo = sectionId ? { href: '/paddles/sections', label: 'Sections' } : { href: '/paddles', label: 'Paddles' }
    return (
      <main className="flex-1 flex flex-col">
        <AppHeader breadcrumb={<Link href={backTo.href} className="tt-nav-link text-sm shrink-0">← {backTo.label}</Link>} />
        <Page width="narrow">
          <EmptyState title={q.error?.message === 'section_too_short' ? 'That section is too short' : sectionId ? 'We can’t find this section' : 'Couldn’t load this section'}
            action={<Link href={backTo.href} className={buttonClass('secondary')}>Back to {backTo.label}</Link>} />
        </Page>
      </main>
    )
  }

  const { passes, sectionM, startLine, finishLine, path, saved } = q.data
  const mine = passes.filter(p => p.mine)
  const best = mine[0]
  const trend = [...mine].sort((x, y) => x.paddledAt.localeCompare(y.paddledAt))
  const chosen = picked.map(k => passes.find(p => key(p) === k)).filter(p => p != null)
  const back = saved ? { href: '/paddles/sections', label: '← Sections' }
    : { href: owner ? `/buddies/${owner}/${src}` : `/paddles/${src}`, label: '← Paddle' }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href={back.href} className="tt-nav-link text-sm shrink-0">{back.label}</Link>} />
      <div className="h-[36vh] min-h-[240px] w-full relative border-b border-border">
        <SectionRaceMapClient racers={[{ trackSegment: path, color: '#38bdf8', label: 'section' }]} startLine={startLine} finishLine={finishLine} />
      </div>
      <Page>
        <div className="flex flex-col gap-4">
        <PageHeader title={saved ? saved.name : 'Every pass'} description={<>
          {(sectionM / 1000).toFixed(2)} km, <span className="text-green">start</span> to <span className="text-red">finish</span>, the same way round.
          {' '}{passes.length} pass{passes.length === 1 ? '' : 'es'}: yours and your buddies&apos;. Times include any stops.
        </>} />

        {saved ? <ManageSaved id={saved.id} name={saved.name} /> : <SaveSection where={where as Extract<Where, { sourceId: string }>} />}
        </div>

        {best && (
          <div className="border-l-2 border-primary pl-4 text-base">
            Your best: <b className="tabular">{fmtDur(best.elapsedS)}</b> ({fmtDur(best.paceS500)} /500) on {fmtDay(best.paddledAt)}
            {trend.length > 1 && <> · your last {Math.min(5, trend.length)}: <span className="tabular">{trend.slice(-5).map(p => fmtDur(p.elapsedS)).join(' → ')}</span></>}
          </div>
        )}

        <section className="flex flex-col gap-2" aria-label="Passes">
        <h2 className="text-lg font-semibold text-fg">Passes</h2>
        <p className="text-sm text-muted">Tick two to compare their lines.</p>
        <div className="overflow-x-auto">
        <div className="border-t border-border min-w-[320px]">
          {passes.map((p, i) => {
            const k = key(p)
            return (
              <label key={k} className={`grid grid-cols-[auto_1.5rem_minmax(0,1fr)_auto_auto] sm:grid-cols-[auto_1.5rem_minmax(0,1fr)_auto_auto_auto] gap-3 items-center px-1 py-2 border-b border-border text-sm cursor-pointer min-h-11 ${picked.includes(k) ? 'bg-primary/15' : 'hover:bg-surface'}`}>
                <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} className="accent-primary w-4 h-4" aria-label={`Compare ${p.name} ${fmtDay(p.paddledAt)} pass ${p.n}`} />
                <span className="text-muted tabular">{i + 1}</span>
                <span className={`min-w-0 truncate ${p.mine ? 'text-fg' : 'text-split'}`}>{p.name} · {fmtDay(p.paddledAt)}{p.n > 1 ? ` · pass ${p.n}` : ''}</span>
                <span className="text-primary-text tabular">{fmtDur(p.elapsedS)}</span>
                <span className="text-muted tabular w-14 text-right">{fmtDur(p.paceS500)}</span>
                <span className="hidden sm:block text-muted tabular w-16 text-right">{p.avgSR != null ? `${Math.round(p.avgSR)} spm` : '—'}</span>
              </label>
            )
          })}
        </div>

        </div>
        </section>

        {chosen.length === 2 && <PassCompare where={where} a={chosen[0]} b={chosen[1]} />}
      </Page>
    </main>
  )
}

// Save a picked section with a name, to come back to (#435).
function SaveSection({ where }: { where: { sourceId: string; owner?: string; aIdx: number; bIdx: number } }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const save = trpc.sections.save.useMutation({ onSuccess: r => router.push(`/paddles/section?id=${r.id}`) })
  return (
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) save.mutate({ ...where, name }) }}>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Name it, e.g. Bridge to the lock" aria-label="Section name"
        className={`${inputClass} flex-1 min-w-0`} />
      <button type="submit" disabled={!name.trim() || save.isPending} className={buttonClass('primary')}>
        {save.isPending ? 'Saving…' : 'Save section'}
      </button>
      {save.isError && <p className="basis-full text-sm text-red" role="alert">{save.error.message === 'too_many_sections' ? 'Couldn’t save: you have 200 sections. Remove one first.' : 'Couldn’t save it. Please try again.'}</p>}
    </form>
  )
}

function ManageSaved({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const rename = trpc.sections.rename.useMutation({ onSuccess: () => { setEditing(null); void utils.sections.passes.invalidate() } })
  const remove = trpc.sections.remove.useMutation({ onSuccess: () => router.push('/paddles/sections') })
  if (editing != null) return (
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (editing.trim()) rename.mutate({ sectionId: id, name: editing }) }}>
      <input value={editing} onChange={e => setEditing(e.target.value)} maxLength={60} aria-label="Section name" className={`${inputClass} flex-1 min-w-0`} />
      <button type="submit" disabled={!editing.trim() || rename.isPending} className={buttonClass('primary')}>{rename.isPending ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={() => setEditing(null)} className={buttonClass('quiet')}>Cancel</button>
    </form>
  )
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setEditing(name)} className={buttonClass('secondary', 'sm')}>Rename</button>
      {confirming ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Remove this section?</span>
          <button type="button" disabled={remove.isPending} onClick={() => remove.mutate({ sectionId: id })} className={buttonClass('danger', 'sm')}>{remove.isPending ? 'Removing…' : 'Remove'}</button>
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass('quiet', 'sm')}>Keep</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={buttonClass('quiet', 'sm', 'text-red hover:text-red')}>Remove</button>
      )}
    </div>
  )
}

type P = { owner: string; paddleId: string; n: number; name: string; paddledAt: string }

function PassCompare({ where, a, b }: { where: Where; a: P; b: P }) {
  const qa = trpc.sections.passLine.useQuery({ where, paddleOwner: a.owner, paddleId: a.paddleId, n: a.n }, { retry: false })
  const qb = trpc.sections.passLine.useQuery({ where, paddleOwner: b.owner, paddleId: b.paddleId, n: b.n }, { retry: false })
  if (qa.isPending || qb.isPending) return <p className="text-base text-muted">Loading the two lines…</p>
  if (!qa.data || !qb.data) return <p className="text-base text-red">Couldn’t load those two passes. Please try again.</p>
  const label = (p: P) => `${p.name} · ${fmtDay(p.paddledAt)}${p.n > 1 ? ` #${p.n}` : ''}`
  return <div><LineCompare key={`${key(a)}|${key(b)}`} a={{ label: label(a), points: qa.data }} b={{ label: label(b), points: qb.data }} /></div>
}
