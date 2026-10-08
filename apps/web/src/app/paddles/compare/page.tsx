'use client'
import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDurWords, split500 } from '@paddlesnitch/analysis/analysis'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import SameOuting from '@/components/analysis/SameOuting'
import { fmtDay } from '@paddlesnitch/core/format'

export default function ComparePage() {
  return <Suspense fallback={<div className="min-h-screen bg-bg" />}><CompareInner /></Suspense>
}

const fmtDate = fmtDay

function Row({ label, a, b, better }: { label: string; a: string; b: string; better?: 'a' | 'b' | '' }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 py-1.5 border-b border-border text-sm tabular">
      <span className="text-muted text-xs self-center">{label}</span>
      <span className={`text-right w-24 ${better === 'a' ? 'text-green' : ''}`}>{a}</span>
      <span className={`text-right w-24 ${better === 'b' ? 'text-green' : ''}`}>{b}</span>
    </div>
  )
}

function CompareInner() {
  const sp = useSearchParams()
  const aId = sp.get('a'), bId = sp.get('b')
  const aQ = trpc.paddles.get.useQuery({ id: aId ?? '' }, { enabled: !!aId, retry: false })
  const bQ = trpc.paddles.get.useQuery({ id: bId ?? '' }, { enabled: !!bId, retry: false })
  const A = !aId ? null : aQ.isPending ? undefined : (aQ.data ?? null)
  const B = !bId ? null : bQ.isPending ? undefined : (bQ.data ?? null)

  if (A === undefined || B === undefined) return <div className="min-h-screen bg-bg text-muted flex items-center justify-center text-sm">Loading…</div>
  if (!A || !B) return (
    <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">Couldn&apos;t load both paddles.</p>
      <Link href="/paddles" className="text-xs tracking-widest text-primary">← PADDLES</Link>
    </div>
  )

  const ra = A.result, rb = B.result
  const paceA = ra.cruiseSpeed, paceB = rb.cruiseSpeed // higher speed = faster = better
  const dPace = 500 / paceA - 500 / paceB // seconds/500 difference (A - B); negative = A faster

  return (
    <div className="min-h-screen">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← PADDLES</Link>} />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold tracking-widest">COMPARE</h1>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] gap-3 mb-2 text-[10px] tracking-widest text-muted">
          <span></span>
          <Link href={`/paddles/${A.id}`} className="text-right w-24 text-muted hover:text-fg">{fmtDate(A.paddledAt)}</Link>
          <Link href={`/paddles/${B.id}`} className="text-right w-24 text-muted hover:text-fg">{fmtDate(B.paddledAt)}</Link>
        </div>

        <Row label="TIME" a={fmtDurWords(ra.durationS)} b={fmtDurWords(rb.durationS)} />
        <Row label="DISTANCE" a={`${ra.distanceKm.toFixed(2)} km`} b={`${rb.distanceKm.toFixed(2)} km`} better={ra.distanceKm > rb.distanceKm ? 'a' : ra.distanceKm < rb.distanceKm ? 'b' : ''} />
        <Row label="PACE /500" a={split500(paceA)} b={split500(paceB)} better={paceA > paceB ? 'a' : paceA < paceB ? 'b' : ''} />
        <Row label="STROKE RATE" a={ra.avgSR != null ? `${Math.round(ra.avgSR)} spm` : '—'} b={rb.avgSR != null ? `${Math.round(rb.avgSR)} spm` : '—'} />
        <Row label="DISTANCE PER STROKE" a={ra.avgDps != null ? `${ra.avgDps.toFixed(1)} m` : '—'} b={rb.avgDps != null ? `${rb.avgDps.toFixed(1)} m` : '—'} better={ra.avgDps != null && rb.avgDps != null ? (ra.avgDps > rb.avgDps ? 'a' : 'b') : ''} />
        <Row label="EFFORTS" a={String(ra.surges.length)} b={String(rb.surges.length)} />
        <Row label="WIND" a={ra.conditions?.windKmh != null ? `${Math.round(ra.conditions.windKmh)} km/h` : '—'} b={rb.conditions?.windKmh != null ? `${Math.round(rb.conditions.windKmh)} km/h` : '—'} />
        <Row label="RIVER FLOW" a={ra.conditions?.flowM3s != null ? `${ra.conditions.flowM3s.toFixed(1)} m³/s` : '—'} b={rb.conditions?.flowM3s != null ? `${rb.conditions.flowM3s.toFixed(1)} m³/s` : '—'} />

        <div className="mt-4 border-l-2 border-primary pl-3 text-sm text-fg">
          {fmtDate(A.paddledAt)} vs {fmtDate(B.paddledAt)}: pace was{' '}
          <b>{Math.abs(dPace) < 0.5 ? 'about the same' : `${Math.abs(dPace).toFixed(0)}s/500 ${dPace < 0 ? 'faster' : 'slower'}`}</b>
          {ra.avgSR != null && rb.avgSR != null && <>, stroke rate {ra.avgSR > rb.avgSR ? 'up' : ra.avgSR < rb.avgSR ? 'down' : 'level'} {Math.abs(Math.round(ra.avgSR - rb.avgSR)) || ''} spm</>}
          , {(ra.distanceKm - rb.distanceKm) >= 0 ? '+' : ''}{(ra.distanceKm - rb.distanceKm).toFixed(1)} km distance.
        </div>

        <SameOuting a={A} b={B} />

        {(A.note?.trim() || B.note?.trim()) && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="text-xs"><div className="text-[10px] text-muted tracking-widest mb-1">NOTE · {fmtDate(A.paddledAt)}</div>{A.note || <span className="text-muted">no note</span>}</div>
            <div className="text-xs"><div className="text-[10px] text-muted tracking-widest mb-1">NOTE · {fmtDate(B.paddledAt)}</div>{B.note || <span className="text-muted">no note</span>}</div>
          </div>
        )}
      </div>
    </div>
  )
}
