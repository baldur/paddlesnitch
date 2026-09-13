import RouteThumb from '@paddlesnitch/ui/RouteThumb'
import { paddleTotals, type PaddleCard } from '@paddlesnitch/core/paddles'

// The signed-in platform home — mirrors the Analyse paddle dashboard so a
// returning paddler lands on their own stuff, not the marketing page. Rendered
// server-side from the shared paddle store. Cross-app links to /analyse use
// plain <a> (the Analyse app runs under its own basePath in prod; two ports in
// dev — see platform-monorepo docs).

// Paddle display formatters. Small enough to keep local; the Analyse app has the
// canonical copies in its analysis lib (both apps render the same shapes).
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const split500 = (spd: number) => (spd > 0.2 ? fmtDur(500 / spd) : '—')
function fmtDurWords(s: number): string {
  const total = Math.round(s)
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`)
  if (m > 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`)
  if (sec > 0 || (h === 0 && m === 0)) parts.push(`${sec} second${sec === 1 ? '' : 's'}`)
  return parts.join(' ')
}
function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }
function fmtSince(iso: string) { try { return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 7) } }

const RECENT = 4
const PANEL = 'bg-surface border border-border rounded'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${PANEL} px-4 py-3`}>
      <div className="text-[10px] text-muted tracking-widest">{label}</div>
      <div className="text-lg font-bold tabular mt-0.5 text-fg">{value}</div>
    </div>
  )
}

function Card({ c }: { c: PaddleCard }) {
  const tag = c.sourceType === 'strava' ? ' · STRAVA' : c.sourceType === 'trial' ? ' · TIME TRIAL' : c.sourceType === 'device' ? ' · TRACKER' : ''
  return (
    <a href={`/analyse/${c.id}`} className="border border-border rounded p-3 flex gap-3 items-center hover:border-primary transition-colors">
      <RouteThumb route={c.route} size={56} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-muted tracking-widest">{fmtDate(c.paddledAt).toUpperCase()}{tag}{c.boatClass ? <span className="text-split"> · {c.boatClass}</span> : ''}</div>
        <div className="text-sm tabular mt-0.5 text-fg"><b>{c.distanceKm.toFixed(2)} km</b> · {fmtDurWords(c.durationS)}</div>
        <div className="text-xs text-muted tabular mt-0.5">cruise {split500(c.cruiseSpeed)}/500{c.avgSR != null && <> · ~{Math.round(c.avgSR)} spm</>}</div>
      </div>
      <span className="text-primary text-xs shrink-0">→</span>
    </a>
  )
}

export default function PersonalHome({ name, cards }: { name?: string; cards: PaddleCard[] }) {
  const totals = paddleTotals(cards)
  return (
    <section className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold tracking-widest text-fg">{name ? `${name.toUpperCase()}'S PADDLES` : 'MY PADDLES'}</h1>
        <a href="/analyse/new" className="px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest rounded hover:bg-primary transition-colors">+ ANALYSE A PADDLE</a>
      </div>

      {/* Profile summary — the paddler's headline stats. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <Stat label="PADDLES" value={String(totals.count)} />
        <Stat label="DISTANCE" value={`${totals.totalKm.toFixed(1)} km`} />
        <Stat label="TIME ON WATER" value={totals.totalS > 0 ? fmtDurWords(totals.totalS) : '—'} />
        <Stat label="SINCE" value={totals.since ? fmtSince(totals.since) : '—'} />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-muted tracking-[0.2em] uppercase">Recent paddles</h2>
        {cards.length > RECENT && (
          <a href="/analyse/library" className="text-[11px] tracking-widest text-muted hover:text-fg">VIEW ALL {cards.length} →</a>
        )}
      </div>

      {cards.length === 0 ? (
        <div className={`${PANEL} p-6 text-center`}>
          <p className="text-sm text-muted">No paddles yet.</p>
          <a href="/analyse/new" className="mt-3 inline-block px-5 py-2.5 bg-primary text-white text-xs font-bold tracking-widest rounded hover:bg-primary transition-colors">ANALYSE YOUR FIRST ONE →</a>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.slice(0, RECENT).map(c => <Card key={c.id} c={c} />)}
        </div>
      )}
    </section>
  )
}
