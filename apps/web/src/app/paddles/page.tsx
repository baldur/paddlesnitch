'use client'
import Link from 'next/link'
import { useState } from 'react'
import { fmtDurWords, split500 } from '@paddlesnitch/analysis/analysis'
import { sourceLabel } from '@paddlesnitch/core/paddles'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'

// PADDLES: every paddle you've saved, with your totals on top. This is also the
// signed-in home (/ redirects here). It replaces two near-copies: a dashboard at
// /paddles showing the latest four, and the full list at /paddles/library
// (both titled "MY PADDLES"; /paddles/library now redirects here).

function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }
function fmtSince(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 7) } }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-border px-4 py-3">
      <div className="text-[10px] text-muted tracking-widest">{label}</div>
      <div className="text-lg font-bold tabular mt-0.5">{value}</div>
    </div>
  )
}

export default function PaddlesPage() {
  const [sel, setSel] = useState<string[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  // Ask who's signed in first: the paddle queries are protected, and firing them
  // signed out logged a 401 in the console on every visit.
  const me = trpc.me.useQuery()
  const signedIn = !!me.data?.user
  const list = trpc.paddles.list.useQuery(undefined, { retry: false, enabled: signedIn })
  const q = trpc.paddles.sessions.useQuery(undefined, { retry: false, enabled: signedIn })
  const utils = trpc.useUtils()
  const delMut = trpc.paddles.delete.useMutation({
    onSuccess: () => { utils.paddles.sessions.invalidate(); utils.paddles.list.invalidate() },
  })

  const del = async (id: string) => {
    await delMut.mutateAsync({ id })
    setConfirming(null)
    setSel(s => s.filter(x => x !== id))
  }
  // Pick up to two to compare; a third replaces the older pick.
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 2 ? [...s, id] : [s[1], id])

  const header = <AppHeader breadcrumb={null} />

  if (me.data && !me.data.user) return (
    <main className="flex-1 flex flex-col">
      {header}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="bg-surface border border-border w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold tracking-widest">PADDLES</h1>
          <p className="text-xs text-muted mt-2 mb-5">Sign in to analyse and save your paddles.</p>
          <a href="/signin?next=/paddles" className="inline-block px-6 py-2.5 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">SIGN IN</a>
        </div>
      </div>
    </main>
  )

  const sessions = q.data
  const totals = list.data?.totals

  return (
    <main className="flex-1 flex flex-col">
      {header}
      <div className="max-w-3xl mx-auto px-4 py-6 w-full">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold tracking-widest">PADDLES</h1>
          <Link href="/paddles/new" className="px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">+ ADD A PADDLE</Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
          <Stat label="PADDLES" value={!totals ? '…' : String(totals.count)} />
          <Stat label="DISTANCE" value={!totals ? '…' : `${totals.totalKm.toFixed(1)} km`} />
          <Stat label="TIME ON WATER" value={!totals ? '…' : (totals.totalS > 0 ? fmtDurWords(totals.totalS) : '—')} />
          <Stat label="SINCE" value={!totals ? '…' : (totals.since ? fmtSince(totals.since) : '—')} />
        </div>

        {sel.length === 2 && (
          <Link href={`/paddles/compare?a=${sel[0]}&b=${sel[1]}`}
            className="block mb-4 px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest text-center">COMPARE THESE TWO →</Link>
        )}
        {sessions && sessions.length > 1 && sel.length < 2 && (
          <p className="text-[11px] text-muted mb-4">{sel.length === 1 ? 'Pick one more to compare.' : 'Tick two paddles to compare them.'}</p>
        )}

        {sessions === undefined && <p className="text-sm text-muted">Loading…</p>}
        {sessions && sessions.length === 0 && (
          <div className="bg-surface border border-border p-6 text-center">
            <p className="text-sm text-muted">No paddles yet.</p>
            <Link href="/paddles/new" className="mt-3 inline-block px-5 py-2.5 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">ADD YOUR FIRST ONE →</Link>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sessions?.map(s => (
            <div key={s.id} className="border border-border p-3 flex gap-3 items-center">
              <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} className="accent-primary" aria-label="Compare" />
              <Link href={`/paddles/${s.id}`} className="flex gap-3 items-center flex-1 min-w-0 group">
                <RouteThumb route={s.route} size={64} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-muted tracking-widest">
                    {fmtDate(s.paddledAt).toUpperCase()}{sourceLabel(s.source.type)}{s.boatClass ? <span className="text-split"> · {s.boatClass}</span> : ''}
                  </div>
                  <div className="text-sm tabular mt-0.5 group-hover:text-primary transition-colors">
                    <b>{s.distanceKm.toFixed(2)} km</b> · {fmtDurWords(s.durationS)}
                  </div>
                  <div className="text-xs text-muted tabular mt-0.5">
                    {split500(s.cruiseSpeed)}/500{s.avgSR != null && <> · {Math.round(s.avgSR)} spm</>}
                  </div>
                  {s.note?.trim() && <div className="text-xs text-split mt-1 truncate">{s.note}</div>}
                </div>
              </Link>
              <div className="shrink-0 text-[10px] tracking-widest">
                {confirming === s.id ? (
                  <span className="flex gap-2 items-center">
                    <span className="text-muted">DELETE?</span>
                    <button onClick={() => del(s.id)} disabled={delMut.isPending} className="text-red hover:underline disabled:opacity-50">YES</button>
                    <button onClick={() => setConfirming(null)} className="text-muted hover:text-fg">NO</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirming(s.id)} className="text-muted hover:text-red">DELETE</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
