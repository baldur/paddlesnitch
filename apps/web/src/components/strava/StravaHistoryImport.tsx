'use client'
import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { selectClass } from '@paddlesnitch/ui/Form'
import { cardClass } from '@paddlesnitch/ui/Card'

// Older Strava paddles (#415). Strava only tells us about paddles recorded
// after it was connected, so:
//  - `first`: by itself, once, bring in about the last month;
//  - `more`: IMPORT OLDER PADDLES, as far back as the paddler picks.
// The open page works through the list one paddle at a time (no background
// job), so it can show progress; when Strava asks us to slow down it waits for
// Strava's next quarter hour and carries on. Closing the page just stops: what
// came in stays, and the next visit picks up the rest.

type Span = 'months3' | 'year' | 'all'
type Item = { id: number; sport: string; startDate: string }
type Progress = { done: number; total: number; added: number; waitUntil?: number; stopped?: 'daily_limit' | 'error' }

const MAX_WAITS = 8   // two hours of quarter-hour waits: past that, Strava's daily allowance is gone
const nextQuarterHour = (now: number) => Math.ceil(now / 900_000) * 900_000 + 20_000
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function useImporter() {
  const utils = trpc.useUtils()
  const importOne = trpc.sources.importStravaPaddle.useMutation()
  const [progress, setProgress] = useState<Progress | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Works through `items`; true when every one was tried.
  const run = async (items: Item[]): Promise<boolean> => {
    let added = 0, waits = 0
    for (let i = 0; i < items.length && alive.current; ) {
      let r
      try { r = await importOne.mutateAsync(items[i]) } catch { setProgress({ done: i, total: items.length, added, stopped: 'error' }); return false }
      if (r.status === 'skipped' && r.reason === 'rate_limited') {
        if (++waits > MAX_WAITS) { setProgress({ done: i, total: items.length, added, stopped: 'daily_limit' }); return false }
        const until = nextQuarterHour(Date.now())
        setProgress({ done: i, total: items.length, added, waitUntil: until })
        await sleep(until - Date.now())
        continue
      }
      if (r.status === 'imported') added++
      i++
      setProgress({ done: i, total: items.length, added })
    }
    await utils.paddles.sessions.invalidate()
    return alive.current
  }
  return { progress, setProgress, run }
}

function Status({ p, what }: { p: Progress; what: string }) {
  if (p.stopped === 'daily_limit') return <>Strava&apos;s limit for today is used up, so we stopped after {p.done} of {p.total}. What came in stays; try again tomorrow for the rest.</>
  if (p.stopped === 'error') return <>Couldn&apos;t bring in all your Strava paddles ({p.done} of {p.total}). Please try again later.</>
  if (p.done >= p.total) return <>{p.added ? `Added ${p.added} paddle${p.added === 1 ? '' : 's'} from Strava.` : 'Your Strava paddles were already here.'}</>
  if (p.waitUntil) return <>Strava asks us to slow down. Carrying on at {clock(p.waitUntil)} ({p.done} of {p.total} so far). Keep this page open.</>
  return <>Bringing in {what} from Strava: {p.done} of {p.total}.</>
}

/** By itself, once: about the last month of Strava paddles. Renders nothing when there's nothing to do. */
export function StravaFirstImport() {
  const q = trpc.sources.stravaHistory.useQuery({ since: 'first' }, { retry: false, staleTime: Infinity })
  const doneMark = trpc.sources.stravaHistoryDone.useMutation()
  const { progress, run } = useImporter()
  const started = useRef(false)
  const data = q.data

  useEffect(() => {
    if (!data || data.status !== 'ok' || data.firstImportDone || started.current) return
    started.current = true
    void run(data.toImport).then(all => { if (all) doneMark.mutate() })
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps -- once, when the list arrives

  if (!data || data.status !== 'ok' || data.firstImportDone || data.toImport.length === 0) return null
  const p = progress ?? { done: 0, total: data.toImport.length, added: 0 }
  return (
    <p role="status" className="text-sm text-muted border-l-2 border-primary pl-3">
      <Status p={p} what="your last month" />
    </p>
  )
}

/** Bring in older paddles: as far back as the paddler picks. */
export function StravaMoreImport() {
  const utils = trpc.useUtils()
  const { progress, setProgress, run } = useImporter()
  const [span, setSpan] = useState<Span>('year')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    setProgress(null)
    try {
      const h = await utils.sources.stravaHistory.fetch({ since: span })
      if (h.status === 'rate_limited') setProgress({ done: 0, total: 0, added: 0, stopped: 'daily_limit' })
      else if (h.status === 'ok') { setProgress({ done: 0, total: h.toImport.length, added: 0 }); await run(h.toImport) }
    } catch { setProgress({ done: 0, total: 0, added: 0, stopped: 'error' }) }
    setBusy(false)
  }

  return (
    <div className={`${cardClass} p-4 mt-2 flex flex-col gap-2`}>
      <span className="text-base font-medium text-fg">Older paddles</span>
      <span className="text-sm text-muted">Bring in paddles you recorded on Strava before you connected it. Ones already here are skipped.</span>
      <div className="flex gap-2 items-center flex-wrap">
        <select value={span} onChange={e => setSpan(e.target.value as Span)} disabled={busy} aria-label="How far back"
          className={`${selectClass} sm:max-w-xs`}>
          <option value="months3">Last 3 months</option>
          <option value="year">Last year</option>
          <option value="all">Everything</option>
        </select>
        <button type="button" onClick={start} disabled={busy} className={buttonClass('secondary')}>
          {busy ? 'Bringing in…' : 'Bring in older paddles'}
        </button>
      </div>
      {progress && <p role="status" className="text-sm text-muted"><Status p={progress} what="your paddles" /></p>}
    </div>
  )
}
