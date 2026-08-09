'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { fmtDurWords, split500 } from '@/lib/analysis'
import type { SessionSummary } from '@/lib/analysis-store'
import AppShell from '@paddlesnitch/ui/AppShell'
import AppAccountNav from '@/components/AppAccountNav'

function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }

export default function LibraryPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null | undefined>(undefined)
  const [sel, setSel] = useState<string[]>([])

  const load = () => fetch('/analyse/api/analyse/sessions').then(r => (r.ok ? r.json() : null)).then(d => setSessions(d?.sessions ?? null)).catch(() => setSessions(null))
  useEffect(() => { load() }, [])

  const del = async (id: string) => {
    if (!confirm('Delete this paddle?')) return
    await fetch(`/analyse/api/analyse/sessions/${id}`, { method: 'DELETE' })
    setSessions(s => s?.filter(x => x.id !== id) ?? null)
    setSel(s => s.filter(x => x !== id))
  }
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 2 ? [...s, id] : [s[1], id])

  return (
    <div className="min-h-screen">
      <AppShell active="analyse" account={<AppAccountNav />} />
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold tracking-widest">MY PADDLES</h1>
          <Link href="/" className="text-xs tracking-widest text-[#64748b] hover:text-[#e2e8f0]">+ ANALYSE A PADDLE</Link>
        </div>

        {sel.length === 2 && (
          <Link href={`/compare?a=${sel[0]}&b=${sel[1]}`}
            className="block mb-4 px-4 py-2 bg-[#0369a1] text-white text-xs font-bold tracking-widest rounded text-center">COMPARE SELECTED (2) →</Link>
        )}
        {sel.length === 1 && <p className="text-[11px] text-[#64748b] mb-4">Select one more to compare.</p>}

        {sessions === undefined && <p className="text-sm text-[#64748b]">Loading…</p>}
        {sessions === null && <p className="text-sm text-[#64748b]">Sign in to see your saved paddles. <a href="/att/auth?next=/analyse/library" className="text-[#0369a1]">Sign in</a></p>}
        {sessions && sessions.length === 0 && <p className="text-sm text-[#64748b]">No paddles yet. <Link href="/" className="text-[#0369a1]">Analyse your first one →</Link></p>}

        <div className="flex flex-col gap-2">
          {sessions?.map(s => (
            <div key={s.id} className="border border-[#1e293b] rounded p-3 flex gap-3 items-start">
              <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} className="mt-1 accent-[#0369a1]" />
              <Link href={`/${s.id}`} className="flex-1 min-w-0">
                <div className="text-[10px] text-[#64748b] tracking-widest">{fmtDate(s.paddledAt).toUpperCase()}{s.source.type === 'strava' ? ' · STRAVA' : s.source.type === 'trial' ? ' · TIME TRIAL' : ''}{s.boatClass ? <span className="text-[#a78bfa]"> · {s.boatClass}</span> : ''}</div>
                <div className="text-sm tabular mt-0.5">
                  <b>{fmtDurWords(s.durationS)}</b> · {s.distanceKm.toFixed(2)} km · cruise {split500(s.cruiseSpeed)}/500
                  {s.avgSR != null && <> · ~{Math.round(s.avgSR)} spm</>}
                  {s.effortCount > 0 && <> · {s.effortCount} efforts</>}
                </div>
                {s.insight && <div className="text-xs text-[#94a3b8] mt-1 line-clamp-2">{s.insight}</div>}
                {s.note?.trim() && <div className="text-xs text-[#a78bfa] mt-1 truncate">📓 {s.note}</div>}
              </Link>
              <button onClick={() => del(s.id)} className="text-[10px] tracking-widest text-[#64748b] hover:text-[#b91c1c]">DELETE</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
