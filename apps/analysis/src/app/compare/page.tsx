'use client'
import Link from 'next/link'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDurWords, split500 } from '@/lib/analysis'
import type { AnalysisSession } from '@/lib/analysis-store'
import AppShell from '@paddlesnitch/ui/AppShell'
import AppAccountNav from '@/components/AppAccountNav'

export default function ComparePage() {
  return <Suspense fallback={<div className="min-h-screen bg-[#0b1220]" />}><CompareInner /></Suspense>
}

function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }

function Row({ label, a, b, better }: { label: string; a: string; b: string; better?: 'a' | 'b' | '' }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 py-1.5 border-b border-[#1e293b] text-sm tabular">
      <span className="text-[#64748b] text-xs self-center">{label}</span>
      <span className={`text-right w-24 ${better === 'a' ? 'text-[#22c55e]' : ''}`}>{a}</span>
      <span className={`text-right w-24 ${better === 'b' ? 'text-[#22c55e]' : ''}`}>{b}</span>
    </div>
  )
}

function CompareInner() {
  const sp = useSearchParams()
  const aId = sp.get('a'), bId = sp.get('b')
  const [A, setA] = useState<AnalysisSession | null | undefined>(undefined)
  const [B, setB] = useState<AnalysisSession | null | undefined>(undefined)

  useEffect(() => {
    const get = (id: string | null) => id ? fetch(`/analyse/api/analyse/sessions/${id}`).then(r => (r.ok ? r.json() : null)).then(d => d?.session ?? null).catch(() => null) : Promise.resolve(null)
    get(aId).then(setA); get(bId).then(setB)
  }, [aId, bId])

  if (A === undefined || B === undefined) return <div className="min-h-screen bg-[#0b1220] text-[#64748b] flex items-center justify-center text-sm">Loading…</div>
  if (!A || !B) return (
    <div className="min-h-screen bg-[#0b1220] text-[#e2e8f0] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-[#64748b]">Couldn&apos;t load both paddles.</p>
      <Link href="/library" className="text-xs tracking-widest text-[#0369a1]">← MY PADDLES</Link>
    </div>
  )

  const ra = A.result, rb = B.result
  const paceA = ra.cruiseSpeed, paceB = rb.cruiseSpeed // higher speed = faster = better
  const dPace = 500 / paceA - 500 / paceB // seconds/500 difference (A - B); negative = A faster

  return (
    <div className="min-h-screen">
      <AppShell active="analyse" account={<AppAccountNav />} />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold tracking-widest">COMPARE</h1>
          <Link href="/library" className="text-xs tracking-widest text-[#64748b] hover:text-[#e2e8f0]">← MY PADDLES</Link>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] gap-3 mb-2 text-[10px] tracking-widest text-[#64748b]">
          <span></span>
          <Link href={`/${A.id}`} className="text-right w-24 text-[#94a3b8] hover:text-[#e2e8f0]">{fmtDate(A.paddledAt)}</Link>
          <Link href={`/${B.id}`} className="text-right w-24 text-[#94a3b8] hover:text-[#e2e8f0]">{fmtDate(B.paddledAt)}</Link>
        </div>

        <Row label="duration" a={fmtDurWords(ra.durationS)} b={fmtDurWords(rb.durationS)} />
        <Row label="distance" a={`${ra.distanceKm.toFixed(2)} km`} b={`${rb.distanceKm.toFixed(2)} km`} better={ra.distanceKm > rb.distanceKm ? 'a' : ra.distanceKm < rb.distanceKm ? 'b' : ''} />
        <Row label="cruise /500" a={split500(paceA)} b={split500(paceB)} better={paceA > paceB ? 'a' : paceA < paceB ? 'b' : ''} />
        <Row label="avg stroke rate" a={ra.avgSR != null ? `${Math.round(ra.avgSR)} spm` : '—'} b={rb.avgSR != null ? `${Math.round(rb.avgSR)} spm` : '—'} />
        <Row label="dist / stroke" a={ra.avgDps != null ? `${ra.avgDps.toFixed(1)} m` : '—'} b={rb.avgDps != null ? `${rb.avgDps.toFixed(1)} m` : '—'} better={ra.avgDps != null && rb.avgDps != null ? (ra.avgDps > rb.avgDps ? 'a' : 'b') : ''} />
        <Row label="efforts" a={String(ra.surges.length)} b={String(rb.surges.length)} />
        <Row label="wind" a={ra.conditions?.windKmh != null ? `${Math.round(ra.conditions.windKmh)} km/h` : '—'} b={rb.conditions?.windKmh != null ? `${Math.round(rb.conditions.windKmh)} km/h` : '—'} />
        <Row label="flow" a={ra.conditions?.flowM3s != null ? `${ra.conditions.flowM3s.toFixed(1)} m³/s` : '—'} b={rb.conditions?.flowM3s != null ? `${rb.conditions.flowM3s.toFixed(1)} m³/s` : '—'} />

        <div className="mt-4 border-l-2 border-[#0369a1] pl-3 text-sm text-[#e2e8f0]">
          {fmtDate(A.paddledAt)} vs {fmtDate(B.paddledAt)}: cruise pace was{' '}
          <b>{Math.abs(dPace) < 0.5 ? 'about the same' : `${Math.abs(dPace).toFixed(0)}s/500 ${dPace < 0 ? 'faster' : 'slower'}`}</b>
          {ra.avgSR != null && rb.avgSR != null && <>, stroke rate {ra.avgSR > rb.avgSR ? 'up' : ra.avgSR < rb.avgSR ? 'down' : 'level'} {Math.abs(Math.round(ra.avgSR - rb.avgSR)) || ''} spm</>}
          , {(ra.distanceKm - rb.distanceKm) >= 0 ? '+' : ''}{(ra.distanceKm - rb.distanceKm).toFixed(1)} km distance.
        </div>

        {(A.note?.trim() || B.note?.trim()) && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="text-xs"><div className="text-[10px] text-[#64748b] tracking-widest mb-1">📓 {fmtDate(A.paddledAt)}</div>{A.note || <span className="text-[#475569]">no note</span>}</div>
            <div className="text-xs"><div className="text-[10px] text-[#64748b] tracking-widest mb-1">📓 {fmtDate(B.paddledAt)}</div>{B.note || <span className="text-[#475569]">no note</span>}</div>
          </div>
        )}
      </div>
    </div>
  )
}
