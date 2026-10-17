'use client'
import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtClock, split500 } from '@paddlesnitch/analysis/analysis'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import SameOuting from '@/components/analysis/SameOuting'
import LineCompare from '@/components/analysis/LineCompare'
import { fmtDay } from '@paddlesnitch/core/format'
import { isMotionOnly } from '@paddlesnitch/core/paddles'
import { Page, PageHeader, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { EmptyState } from '@paddlesnitch/ui/Card'
import LoadingState from '@/components/LoadingState'

export default function ComparePage() {
  return <Suspense fallback={<Shell><LoadingState label="Loading" /></Shell>}><CompareInner /></Suspense>
}

// Every state of the page has the site header and a way back (it once had
// neither while loading or when a paddle couldn't be read).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← Paddles</Link>} />
      <Page>{children}</Page>
    </main>
  )
}

const fmtDate = fmtDay

function Row({ label, a, b, better }: { label: string; a: string; b: string; better?: 'a' | 'b' | '' }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 py-2 border-b border-border text-base tabular">
      <span className={`${eyebrowClass} self-center`}>{label}</span>
      <span className={`text-right w-24 sm:w-32 ${better === 'a' ? 'text-green' : ''}`}>{a}</span>
      <span className={`text-right w-24 sm:w-32 ${better === 'b' ? 'text-green' : ''}`}>{b}</span>
    </div>
  )
}

function CompareInner() {
  const sp = useSearchParams()
  const aId = sp.get('a'), bId = sp.get('b')
  // B can be a buddy's paddle (bOwner = their id): fetched through the buddy
  // rules, so it comes without their note or AI text (buddies-and-compare.md).
  const bOwner = sp.get('bOwner')
  const aQ = trpc.paddles.get.useQuery({ id: aId ?? '' }, { enabled: !!aId, retry: false })
  const bQ = trpc.paddles.get.useQuery({ id: bId ?? '' }, { enabled: !!bId && !bOwner, retry: false })
  const buddyQ = trpc.buddies.paddle.useQuery({ userId: bOwner ?? '', id: bId ?? '' }, { enabled: !!bId && !!bOwner, retry: false })
  const A = !aId ? null : aQ.isPending ? undefined : (aQ.data ?? null)
  const B = !bId ? null
    : bOwner ? (buddyQ.isPending ? undefined : buddyQ.data ? { ...buddyQ.data.paddle, note: '' } : null)
    : bQ.isPending ? undefined : (bQ.data ?? null)
  const buddyName = buddyQ.data?.name

  if (A === undefined || B === undefined) return <Shell><LoadingState label="Loading" /></Shell>
  if (!A || !B) return (
    <Shell>
      <PageHeader title="Compare" />
      <EmptyState title="Couldn't load both paddles" body="One of them may have been deleted, or a buddy may have stopped sharing it."
        action={<Link href="/paddles" className={buttonClass('secondary')}>Back to Paddles</Link>} />
    </Shell>
  )

  // A paddle without a map (#414) has no route, distance or pace to compare.
  if (isMotionOnly(A.result) || isMotionOnly(B.result)) return (
    <Shell>
      <PageHeader title="Compare" />
      <EmptyState title="These two can't be compared" body="The GPS failed on one of these paddles, so there's no route to compare."
        action={<Link href="/paddles" className={buttonClass('secondary')}>Back to Paddles</Link>} />
    </Shell>
  )

  const ra = A.result, rb = B.result
  const labelA = bOwner ? `You · ${fmtDate(A.paddledAt)}` : fmtDate(A.paddledAt)
  const labelB = bOwner ? `${buddyName ?? 'Buddy'} · ${fmtDate(B.paddledAt)}` : fmtDate(B.paddledAt)
  const hrefB = bOwner ? `/buddies/${bOwner}/${B.id}` : `/paddles/${B.id}`
  const paceA = ra.cruiseSpeed, paceB = rb.cruiseSpeed // higher speed = faster = better
  const dPace = 500 / paceA - 500 / paceB // seconds/500 difference (A - B); negative = A faster

  return (
    <Shell>
        <PageHeader title="Compare" description={`${labelA} and ${labelB}`} />

        <div>
        <LineCompare a={{ label: labelA, points: ra.points }} b={{ label: labelB, points: rb.points }} />

        <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-2 border-b border-border text-sm">
          <span></span>
          <Link href={`/paddles/${A.id}`} className="text-right w-24 sm:w-32 text-primary-text hover:underline">{labelA}</Link>
          <Link href={hrefB} className="text-right w-24 sm:w-32 text-primary-text hover:underline">{labelB}</Link>
        </div>
        <Row label="Time" a={fmtClock(ra.durationS)} b={fmtClock(rb.durationS)} />
        <Row label="Distance" a={`${ra.distanceKm.toFixed(2)} km`} b={`${rb.distanceKm.toFixed(2)} km`} better={ra.distanceKm > rb.distanceKm ? 'a' : ra.distanceKm < rb.distanceKm ? 'b' : ''} />
        <Row label="Pace /500" a={split500(paceA)} b={split500(paceB)} better={paceA > paceB ? 'a' : paceA < paceB ? 'b' : ''} />
        <Row label="Stroke rate" a={ra.avgSR != null ? `${Math.round(ra.avgSR)} spm` : '—'} b={rb.avgSR != null ? `${Math.round(rb.avgSR)} spm` : '—'} />
        <Row label="Per stroke" a={ra.avgDps != null ? `${ra.avgDps.toFixed(1)} m` : '—'} b={rb.avgDps != null ? `${rb.avgDps.toFixed(1)} m` : '—'} better={ra.avgDps != null && rb.avgDps != null ? (ra.avgDps > rb.avgDps ? 'a' : 'b') : ''} />
        <Row label="Efforts" a={String(ra.surges.length)} b={String(rb.surges.length)} />
        <Row label="Wind" a={ra.conditions?.windKmh != null ? `${Math.round(ra.conditions.windKmh)} km/h` : '—'} b={rb.conditions?.windKmh != null ? `${Math.round(rb.conditions.windKmh)} km/h` : '—'} />
        <Row label="River flow" a={ra.conditions?.flowM3s != null ? `${ra.conditions.flowM3s.toFixed(1)} m³/s` : '—'} b={rb.conditions?.flowM3s != null ? `${rb.conditions.flowM3s.toFixed(1)} m³/s` : '—'} />

        <div className="mt-6 border-l-2 border-primary pl-4 text-base text-fg">
          {labelA} vs {labelB}: pace was{' '}
          <b>{Math.abs(dPace) < 0.5 ? 'about the same' : `${Math.abs(dPace).toFixed(0)} s/500 ${dPace < 0 ? 'faster' : 'slower'}`}</b>
          {ra.avgSR != null && rb.avgSR != null && <>, stroke rate {ra.avgSR > rb.avgSR ? 'up' : ra.avgSR < rb.avgSR ? 'down' : 'level'} {Math.abs(Math.round(ra.avgSR - rb.avgSR)) || ''} spm</>}
          , {(ra.distanceKm - rb.distanceKm) >= 0 ? '+' : ''}{(ra.distanceKm - rb.distanceKm).toFixed(1)} km distance.
        </div>

        {/* One person's two recordings of the same outing: not for a buddy's paddle. */}
        {!bOwner && <SameOuting a={A} b={B} />}

        {!bOwner && (A.note?.trim() || B.note?.trim()) && (
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="text-sm"><p className={`${eyebrowClass} mb-1`}>Note · {fmtDate(A.paddledAt)}</p>{A.note || <span className="text-muted">No note</span>}</div>
            <div className="text-sm"><p className={`${eyebrowClass} mb-1`}>Note · {fmtDate(B.paddledAt)}</p>{B.note || <span className="text-muted">No note</span>}</div>
          </div>
        )}
        </div>
    </Shell>
  )
}
