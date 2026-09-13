'use client'
import Link from 'next/link'
import { fmtDurWords, split500 } from '@paddlesnitch/analysis/analysis'
import { trpc } from '@/lib/trpc'
import type { PaddleCard as Paddle } from '@paddlesnitch/core/paddles'
import AppShell from '@paddlesnitch/ui/AppShell'
import AppAccountNav from '@/components/AppAccountNav'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'

const PANEL = 'bg-[#0f172a]/95 border border-[#1e293b] rounded'
const RECENT = 4  // paddles shown on the home before "view all"

function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }
function fmtSince(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 7) } }

function Frame({ nav, children }: { nav?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <AppShell active="analyse" nav={nav} account={<AppAccountNav />} />
      {children}
    </div>
  )
}

// A lean, read-only paddle card for the home — route shape + the basics, linking
// into the deep analysis. (The library page owns the richer card with compare +
// delete.)
function PaddleCard({ p }: { p: Paddle }) {
  const tag = p.sourceType === 'strava' ? ' · STRAVA' : p.sourceType === 'trial' ? ' · TIME TRIAL' : p.sourceType === 'device' ? ' · TRACKER' : ''
  return (
    <Link href={`/paddles/${p.id}`} className="border border-[#1e293b] rounded p-3 flex gap-3 items-center hover:border-[#0369a1] transition-colors">
      <RouteThumb route={p.route} size={56} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-[#64748b] tracking-widest">{fmtDate(p.paddledAt).toUpperCase()}{tag}{p.boatClass ? <span className="text-[#a78bfa]"> · {p.boatClass}</span> : ''}</div>
        <div className="text-sm tabular mt-0.5"><b>{p.distanceKm.toFixed(2)} km</b> · {fmtDurWords(p.durationS)}</div>
        <div className="text-xs text-[#94a3b8] tabular mt-0.5">cruise {split500(p.cruiseSpeed)}/500{p.avgSR != null && <> · ~{Math.round(p.avgSR)} spm</>}</div>
      </div>
      <span className="text-[#0369a1] text-xs shrink-0">→</span>
    </Link>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${PANEL} px-4 py-3`}>
      <div className="text-[10px] text-[#64748b] tracking-widest">{label}</div>
      <div className="text-lg font-bold tabular mt-0.5">{value}</div>
    </div>
  )
}

export default function AnalyseHome() {
  // One typed call for the whole dashboard. A protected procedure, so an
  // UNAUTHORIZED error is simply the signed-out state (no separate /me probe).
  const q = trpc.paddles.list.useQuery(undefined, { retry: false })

  // Signed out — the entry panel.
  if (q.isError) return (
    <Frame>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className={`${PANEL} w-full max-w-md p-6 text-center`}>
          <h1 className="text-lg font-bold tracking-widest">PADDLE ANALYSIS</h1>
          <p className="text-xs text-[#64748b] mt-2 mb-5">Sign in to analyse your paddles, save them to your diary, and track progress over time.</p>
          <a href="/att/auth?next=/paddles" className="inline-block px-6 py-2.5 bg-[#0369a1] text-white text-xs font-bold tracking-widest rounded hover:bg-[#0284c7]">SIGN IN / SIGN UP</a>
        </div>
      </div>
    </Frame>
  )

  const loading = q.isPending
  const cards = q.data?.cards ?? []
  const totals = q.data?.totals

  return (
    <Frame nav={<Link href="/paddles/library" className="text-muted hover:text-fg tracking-widest transition-colors">MY PADDLES</Link>}>
      <div className="max-w-3xl mx-auto px-4 py-6 w-full">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold tracking-widest">MY PADDLES</h1>
          <Link href="/paddles/new" className="px-4 py-2 bg-[#0369a1] text-white text-xs font-bold tracking-widest rounded hover:bg-[#0284c7]">+ ANALYSE A PADDLE</Link>
        </div>

        {/* Profile summary — a subset of the profile page's headline stats. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
          <Stat label="PADDLES" value={loading || !totals ? '…' : String(totals.count)} />
          <Stat label="DISTANCE" value={loading || !totals ? '…' : `${totals.totalKm.toFixed(1)} km`} />
          <Stat label="TIME ON WATER" value={loading || !totals ? '…' : (totals.totalS > 0 ? fmtDurWords(totals.totalS) : '—')} />
          <Stat label="SINCE" value={loading || !totals ? '…' : (totals.since ? fmtSince(totals.since) : '—')} />
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs text-[#64748b] tracking-[0.2em] uppercase">Recent paddles</h2>
          {cards.length > RECENT && (
            <Link href="/paddles/library" className="text-[11px] tracking-widest text-[#64748b] hover:text-[#e2e8f0]">VIEW ALL {cards.length} →</Link>
          )}
        </div>

        {loading && <p className="text-sm text-[#64748b]">Loading…</p>}
        {!loading && cards.length === 0 && (
          <div className={`${PANEL} p-6 text-center`}>
            <p className="text-sm text-[#94a3b8]">No paddles yet.</p>
            <Link href="/paddles/new" className="mt-3 inline-block px-5 py-2.5 bg-[#0369a1] text-white text-xs font-bold tracking-widest rounded hover:bg-[#0284c7]">ANALYSE YOUR FIRST ONE →</Link>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {cards.slice(0, RECENT).map(p => <PaddleCard key={p.id} p={p} />)}
        </div>
      </div>
    </Frame>
  )
}
