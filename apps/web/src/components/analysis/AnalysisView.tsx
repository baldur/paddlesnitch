'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo, useRef } from 'react'
import AnalysisMapClient from '@/components/map/AnalysisMapClient'
import AppHeader from '@/components/AppHeader'
import PaddleChart from './PaddleChart'
import { ramp, scaleBounds } from '@/components/map/colour-scale'
import type { AnalysisResult } from '@paddlesnitch/analysis/analysis'
import { fmtDur, fmtClock, split500, rescaleDoubling, roundStrokes } from '@paddlesnitch/analysis/analysis'
import { noPaddleMessage } from '@paddlesnitch/timing/device'
import { gateAt, type Racer } from '@paddlesnitch/analysis/similar'
import { haversine } from '@paddlesnitch/timing/geo'
import { fmtDay, fmtWeekday } from '@paddlesnitch/core/format'
import { PageHeader, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Stat, badgeClass, cardClass, Chevron } from '@paddlesnitch/ui/Card'
import { Field, inputClass, selectClass } from '@paddlesnitch/ui/Form'
import { BOAT_CLASSES, BOAT_CLASS_INFO, expectedSeats, seatLabel, type BoatClass, type Seat } from '@paddlesnitch/core/types'
import { isMotionOnly } from '@paddlesnitch/core/paddles'
import { trpc } from '@/lib/trpc'
import { sourceName } from './SameOuting'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (d?: number) => (d == null ? '' : COMPASS[Math.round(d / 45) % 8])
const PANEL = 'bg-surface/95 border border-border rounded-control backdrop-blur-sm'

function WindRose({ dir }: { dir: number }) {
  const a = ((dir + 180) * Math.PI) / 180
  const x = Math.sin(a) * 9, y = -Math.cos(a) * 9
  return (
    <svg width="20" height="20" viewBox="-13 -13 26 26" className="inline-block align-middle" aria-hidden>
      <circle r="12" fill="var(--color-bg, #0b1220)" stroke="var(--color-border-strong, #334155)" />
      <line x1={-x} y1={-y} x2={x} y2={y} stroke="var(--color-split, #a78bfa)" strokeWidth="2" />
      <circle cx={x} cy={y} r="3" fill="var(--color-split, #a78bfa)" />
    </svg>
  )
}

export type ViewData = AnalysisResult & { insightModel?: string; paddledAt?: string; source?: { type: 'file' | 'strava' | 'trial' | 'device'; stravaActivityId?: number } }

// One paddle: the site header, the map (with only the colour scale, the replay
// bar and section picking over it), then everything to read below it, and the
// actions in a column beside (under, on a phone). It replaced a full-screen map
// with floating panels that piled on top of each other on a phone (site review,
// 2026-10). Reused by the live analyse flow, the saved paddle and the shared
// view. `sessionId` enables the diary notes editor and the
// "race a section" flow (which needs a saved source to match against).
export default function AnalysisView({ data: dataProp, sessionId, initialNote = '', initialBoatClass, initialSeat, onNewFile, readOnly = false, summaryPending = false, buddy, initialHiddenFromBuddies = false }: {
  data: ViewData
  sessionId?: string
  initialNote?: string
  initialBoatClass?: BoatClass
  initialSeat?: Seat
  onNewFile?: () => void
  // Public shared view: hide the owner-only "PADDLES" link and show a
  // "analyse your own" call to action instead (#202).
  readOnly?: boolean
  // The AI summary is still being written (performance.md, phase 4): the
  // plain one shows meanwhile, with a line saying so.
  summaryPending?: boolean
  // A buddy's paddle (read-only): whose it is, and their list to go back to.
  buddy?: { name: string; href: string; userId: string; paddleId: string }
  // The owner hid this paddle from their buddies.
  initialHiddenFromBuddies?: boolean
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [hiddenFromBuddies, setHiddenFromBuddies] = useState(initialHiddenFromBuddies)
  const setHidden = trpc.paddles.setHiddenFromBuddies.useMutation({ onSuccess: r => setHiddenFromBuddies(r.hidden) })
  const setDoublingMut = trpc.paddles.setDoubling.useMutation()
  const setNoteMut = trpc.paddles.setNote.useMutation()
  const shareMut = trpc.paddles.share.useMutation()
  const highlights = trpc.paddles.highlights.useQuery({ id: sessionId ?? '' }, { enabled: !!sessionId && !readOnly, retry: false }).data ?? []
  const sameOuting = trpc.paddles.sameOuting.useQuery({ id: sessionId ?? '' }, { enabled: !!sessionId && !readOnly, retry: false }).data ?? []
  const unshareMut = trpc.paddles.unshare.useMutation()
  const setBoatMut = trpc.paddles.setBoat.useMutation()
  // Deleting lives here, at the end of the paddle's own actions (it used to
  // sit on every row of the list, as loud as the paddle).
  const delMut = trpc.paddles.delete.useMutation()
  const deletePaddle = async () => {
    if (!sessionId) return
    try {
      await delMut.mutateAsync({ id: sessionId })
      await utils.paddles.sessions.invalidate()
      router.push('/paddles')
    } catch { /* the error shows under the button */ }
  }
  // SUP→kayak stroke-rate doubling is decided automatically at analysis time,
  // but the paddler can flip it here (e.g. an uploaded file we assumed was
  // kayak but was actually rowing). Rescaling is a pure transform on the result
  // — instant locally, then persisted to the saved paddle.
  const [srDoubled, setSrDoubled] = useState(dataProp.strokeRateDoubled)
  const [srSaving, setSrSaving] = useState(false)
  const data = useMemo<ViewData>(() => ({ ...rescaleDoubling(dataProp, srDoubled), paddledAt: dataProp.paddledAt, source: dataProp.source, insightModel: dataProp.insightModel }), [dataProp, srDoubled])
  const toggleDouble = async () => {
    const next = !srDoubled
    setSrDoubled(next)
    if (!sessionId) return
    setSrSaving(true)
    try { await setDoublingMut.mutateAsync({ id: sessionId, doubleStrokeRate: next }) }
    catch { /* the local view already reflects it; a failed persist is non-fatal */ }
    finally { setSrSaving(false) }
  }
  const [metric, setMetric] = useState<'speed' | 'sr'>('speed')
  const [cursor, setCursor] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [note, setNote] = useState(initialNote)
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Which panel under the actions is open (share has its own: it mints a link).
  const [open, setOpen] = useState<'notes' | 'boat' | 'more' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Boat metadata — the boat class + which seat the paddler was in.
  const [boatClass, setBoatClass] = useState<BoatClass | ''>(initialBoatClass ?? '')
  const [seat, setSeat] = useState<Seat | ''>(initialSeat ?? '')
  const [boatState, setBoatState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Sharing — an opt-in public link for this paddle (#202).
  const [showShare, setShowShare] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'working' | 'copied'>('idle')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // "Race a section" selection state.
  const [sectionMode, setSectionMode] = useState(false)
  const [aIdx, setAIdx] = useState<number | null>(null)
  const [bIdx, setBIdx] = useState<number | null>(null)
  const [findState, setFindState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [matches, setMatches] = useState<Racer[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sectionErr, setSectionErr] = useState('')
  const [sectionInsight, setSectionInsight] = useState<{ text: string } | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setCursor(c => { const n = (c ?? 0) + 2; if (n >= data.points.length - 1) { setPlaying(false); return data.points.length - 1 } return n })
    }, 60)
    timer.current = id
    return () => clearInterval(id)
  }, [playing, data.points.length])

  const saveNote = async () => {
    if (!sessionId) return
    setNoteState('saving')
    try {
      await setNoteMut.mutateAsync({ id: sessionId, note })
      setNoteState('saved'); setTimeout(() => setNoteState('idle'), 1500)
    } catch { setNoteState('idle') }
  }

  // Opt this paddle into a public link (minting one lazily on first open), copy
  // it, or revoke it. Owner only — gated on sessionId at the call site. (#202)
  const toggleShare = async () => {
    const next = !showShare
    setShowShare(next)
    if (next && !shareUrl && sessionId) {
      setShareState('working')
      try {
        const d = await shareMut.mutateAsync({ id: sessionId })
        if (d.shareId) setShareUrl(`${window.location.origin}/paddles/shared/${d.shareId}`)
      } catch { /* leave the panel open; the paddler can reopen to retry */ }
      finally { setShareState('idle') }
    }
  }
  const copyShare = async () => {
    if (!shareUrl) return
    try { await navigator.clipboard.writeText(shareUrl); setShareState('copied'); setTimeout(() => setShareState('idle'), 1500) }
    catch { /* clipboard blocked — the link is shown for manual copy */ }
  }
  const stopSharing = async () => {
    if (!sessionId) return
    setShareState('working')
    try { await unshareMut.mutateAsync({ id: sessionId }); setShareUrl(null); setShowShare(false) }
    catch { /* the link may still resolve until the next try */ }
    finally { setShareState('idle') }
  }
  // Download the branded share-card image (the OG image for this shared paddle)
  // so the paddler can post it or add it as a photo to their Strava activity.
  const downloadImage = async () => {
    if (!shareUrl) return
    try {
      const res = await fetch(`${shareUrl}/opengraph-image`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'paddlesnitch.png'
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch { /* download blocked — the link still works for sharing */ }
  }

  // Persist boat class + seat. `cls`/`st` are passed explicitly (state may not
  // have flushed when a dropdown onChange triggers the save).
  const saveBoat = async (cls: BoatClass | '', st: Seat | '') => {
    if (!sessionId) return
    setBoatState('saving')
    try {
      const session = await setBoatMut.mutateAsync({ id: sessionId, boatClass: cls || null, seat: st === '' ? null : st })
      // Picking a boat class also sets the doubling server-side (kayak → ×2);
      // sync the view's toggle so the numbers/map update to match.
      if (typeof session?.result?.strokeRateDoubled === 'boolean') setSrDoubled(session.result.strokeRateDoubled)
      setBoatState('saved'); setTimeout(() => setBoatState('idle'), 1500)
    } catch { setBoatState('idle') }
  }
  const onBoatClass = (cls: BoatClass | '') => {
    // Reset the seat if it's no longer valid for the new class (or the class cleared).
    const seats = cls ? expectedSeats(cls) : []
    const nextSeat: Seat | '' = cls && seat !== '' && seats.includes(seat) ? seat : ''
    setBoatClass(cls); setSeat(nextSeat); saveBoat(cls, nextSeat)
  }
  const onSeat = (st: Seat | '') => { setSeat(st); if (boatClass) saveBoat(boatClass, st) }
  const boatBadge = boatClass ? `${boatClass}${seat !== '' && BOAT_CLASS_INFO[boatClass].crewSize > 1 ? ` · ${seatLabel(boatClass, seat)}` : ''}` : ''

  // --- race-a-section helpers ---
  const nearestIdx = (lat: number, lng: number) => {
    let best = 0, bd = Infinity
    data.points.forEach((p, i) => { const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2; if (d < bd) { bd = d; best = i } })
    return best
  }
  const onPick = (lat: number, lng: number) => {
    const idx = nearestIdx(lat, lng)
    setMatches([]); setFindState('idle'); setSectionErr(''); setSectionInsight(null)
    if (aIdx == null) setAIdx(idx)
    else if (bIdx == null) setBIdx(idx)
    else { setAIdx(idx); setBIdx(null) } // third click starts a fresh selection
  }
  const resetSection = () => { setAIdx(null); setBIdx(null); setMatches([]); setFindState('idle'); setSectionErr(''); setSelected(new Set()); setSectionInsight(null) }
  const exitSection = () => { setSectionMode(false); resetSection() }

  const pts = data.points
  const sectionM = aIdx != null && bIdx != null
    ? (() => { const lo = Math.min(aIdx, bIdx), hi = Math.max(aIdx, bIdx); let d = 0; for (let i = lo + 1; i <= hi; i++) d += haversine([pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]); return d })()
    : 0
  const startLine = aIdx != null ? gateAt(pts, aIdx) : null
  const finishLine = bIdx != null ? gateAt(pts, bIdx) : null

  const findSimilar = async () => {
    if (aIdx == null || bIdx == null || !sessionId) return
    setFindState('loading'); setSectionErr('')
    try {
      const res = await utils.similar.find.fetch({ sourceId: sessionId, aIdx, bIdx })
      if (!res.ok) {
        setSectionErr(res.reason === 'section_too_short' ? 'Pick a longer section (at least 200 m).' : 'Couldn’t search your paddles. Please try again.')
        setFindState('error'); return
      }
      setMatches(res.matches ?? []); setSelected(new Set()); setFindState('done')
    } catch { setSectionErr('Couldn’t search your paddles. Please try again.'); setFindState('error') }
  }

  const raceSelected = () => {
    if (!sessionId || aIdx == null || bIdx == null || selected.size === 0) return
    const qs = new URLSearchParams({ src: sessionId, a: String(aIdx), b: String(bIdx), ids: [...selected].join(',') })
    router.push(`/paddles/compare/section?${qs.toString()}`)
  }

  const analyseSection = async () => {
    if (aIdx == null || bIdx == null || !sessionId) return
    setInsightLoading(true); setSectionErr(''); setSectionInsight(null)
    try {
      const res = await utils.similar.sectionInsight.fetch({ sourceId: sessionId, aIdx, bIdx })
      if (res.reason === 'section_too_short') {
        setSectionErr('Pick a longer section (at least 200 m).')
        return
      }
      setSectionInsight({ text: res.insight })
    } catch { setSectionErr('Couldn’t analyse that section. Please try again.') }
    finally { setInsightLoading(false) }
  }

  const c = data.conditions
  // The shared fixed format: this view is rendered on the server too.
  const paddled = data.paddledAt ? fmtWeekday(data.paddledAt) : ''
  const fmtMatchDate = fmtDay

  const cur = data.points[cursor ?? 0]
  const scale = scaleBounds(data.points, metric)
  // A pace too slow to read as /500 (a drift, a turn) shows as "slower".
  const paceOr = (speed: number, fallback: string) => { const p = split500(speed); return p === '—' ? fallback : p }
  const scaleLabel = (v: number, end: 'lo' | 'hi') => (metric === 'speed' ? `${paceOr(v, end === 'lo' ? 'slower' : 'faster')}${split500(v) === '—' ? '' : '/500'}` : `${Math.round(v)} spm`)
  const isTracker = data.source?.type === 'device'
  // A paddle without a map (#414): the tracker's GPS failed, so no map, speed
  // or pace, and nothing to compare or pick a section on.
  const motionOnly = isMotionOnly(dataProp)
  const owner = !!sessionId && !readOnly
  const source = SOURCE[data.source?.type ?? '']

  return (
    <main className="flex-1 flex flex-col bg-bg text-fg">
      <AppHeader breadcrumb={buddy
        ? <Link href={buddy.href} className="tt-nav-link text-sm shrink-0">← {buddy.name}&apos;s paddles</Link>
        : readOnly
        ? <span className="text-muted text-sm">A shared paddle</span>
        : <Link href="/paddles" className="tt-nav-link text-sm shrink-0">← Paddles</Link>} />

      {/* The map, with only what belongs on a map over it: the colour scale,
          the replay bar, and picking a section. Everything to read is below. */}
      {!motionOnly && <section className="relative h-[52vh] min-h-[300px] max-h-[640px] border-b border-border" aria-label="Map">
        <div className="absolute inset-0">
          <AnalysisMapClient points={data.points} stops={data.stops} surges={data.surges} metric={metric} cursor={cursor}
            pickMode={sectionMode} onPick={onPick} startLine={startLine} finishLine={finishLine}
            markA={aIdx != null ? { lat: pts[aIdx].lat, lng: pts[aIdx].lng } : null}
            markB={bIdx != null ? { lat: pts[bIdx].lat, lng: pts[bIdx].lng } : null} />
        </div>

        {!sectionMode && (
          <div className={`${PANEL} absolute top-3 right-3 z-[1000] p-1.5 flex flex-col gap-1.5`}>
            <div className="flex items-center gap-1" role="group" aria-label="Colour the track by">
              {(['speed', 'sr'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMetric(m)} disabled={m === 'sr' && dataProp.avgSR == null} aria-pressed={metric === m}
                  className={`min-h-9 px-3 rounded-[4px] text-sm disabled:opacity-30 ${metric === m ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}>
                  {m === 'speed' ? 'Speed' : 'Rate'}
                </button>
              ))}
            </div>
            {scale && (
              <div className="px-1" aria-label="Colour scale">
                <div className="h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${[0, 0.4, 0.7, 1].map(ramp).join(',')})` }} />
                <div className="flex justify-between gap-3 text-xs text-muted tabular mt-1">
                  <span>{scaleLabel(scale.lo, 'lo')}</span><span>{scaleLabel(scale.hi, 'hi')}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* section match list */}
        {sectionMode && findState === 'done' && (
          <div className={`${PANEL} absolute top-3 right-3 z-[1000] p-2 w-[min(320px,calc(100vw-1.5rem))] max-h-[40vh] overflow-auto`}>
            <p className="text-sm text-muted px-1 mb-1">
              {matches.length ? `${matches.length} other ${matches.length === 1 ? 'paddle covers' : 'paddles cover'} this section` : 'No other paddles cover this section'}
            </p>
            {matches.map(m => {
              const on = selected.has(m.sessionId)
              return (
                <label key={m.sessionId} className={`flex items-center gap-2 min-h-11 px-1 rounded-[4px] cursor-pointer text-sm ${on ? 'bg-primary/20' : 'hover:bg-surface-2'}`}>
                  <input type="checkbox" checked={on} onChange={() => setSelected(s => { const n = new Set(s); if (n.has(m.sessionId)) n.delete(m.sessionId); else n.add(m.sessionId); return n })} className="accent-primary w-4 h-4" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-fg">{fmtMatchDate(m.paddledAt)}</span>
                    <span className="block text-muted">{Math.round(m.score * 100)}% same route</span>
                  </span>
                  <span className="tabular text-muted text-right">{fmtDur(m.elapsedS)}<br />{split500(m.cruiseSpeed)} /500</span>
                </label>
              )
            })}
            {matches.length > 0 && (
              <button type="button" onClick={raceSelected} disabled={selected.size === 0} className={buttonClass('primary', 'sm', 'mt-2 w-full')}>
                Race selected ({selected.size})
              </button>
            )}
          </div>
        )}

        {/* bottom: replay bar, OR the section-picking panel */}
        {sectionMode ? (
          <div className={`${PANEL} absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] p-3 w-[min(560px,calc(100vw-1.5rem))] text-sm`}>
            <p className={`${eyebrowClass} text-split mb-1`}>Pick a section</p>
            <p className="text-fg">
              {aIdx == null && 'Tap where the section starts on your track.'}
              {aIdx != null && bIdx == null && 'Now tap where it ends.'}
              {aIdx != null && bIdx != null && (
                <span>Section: <b className="tabular text-fg">{(sectionM / 1000).toFixed(2)} km</b>, <span className="text-green">start</span> to <span className="text-red">finish</span>. See every time you{buddy ? '' : ' and your buddies'} paddled it, look at it closely, or compare it with your other paddles.</span>
              )}
            </p>
            {sectionErr && <p className="text-red mt-1">{sectionErr}</p>}
            {sectionInsight && <p className="mt-2 border-l-2 border-split pl-2 text-fg">{sectionInsight.text}</p>}
            <div className="flex gap-2 mt-2 flex-wrap">
              {/* Every time you or your buddies paddled this section the same way. */}
              {aIdx != null && bIdx != null && (
                <Link href={buddy
                  ? `/paddles/section?src=${buddy.paddleId}&owner=${buddy.userId}&a=${aIdx}&b=${bIdx}`
                  : `/paddles/section?src=${sessionId}&a=${aIdx}&b=${bIdx}`}
                  className={buttonClass('primary', 'sm')}>Every pass</Link>
              )}
              {!buddy && aIdx != null && bIdx != null && (
                <>
                  <button type="button" onClick={analyseSection} disabled={insightLoading} className={buttonClass('secondary', 'sm')}>
                    {insightLoading ? 'Looking…' : sectionInsight ? 'Look again' : 'Look closely'}
                  </button>
                  <button type="button" onClick={findSimilar} disabled={findState === 'loading'} className={buttonClass('secondary', 'sm')}>
                    {findState === 'loading' ? 'Searching…' : 'Compare with other paddles'}
                  </button>
                </>
              )}
              <span className="flex gap-1 ml-auto">
                {(aIdx != null || bIdx != null) && <button type="button" onClick={resetSection} className={buttonClass('quiet', 'sm')}>Reset</button>}
                <button type="button" onClick={exitSection} className={buttonClass('quiet', 'sm')}>Done</button>
              </span>
            </div>
          </div>
        ) : (
          <div className={`${PANEL} absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] pr-3 flex items-center gap-2 w-[min(520px,calc(100vw-1.5rem))]`} aria-label="Replay">
            <button type="button" onClick={() => { if (cursor == null || cursor >= data.points.length - 1) setCursor(0); setPlaying(p => !p) }}
              aria-label={playing ? 'Pause' : 'Play'} className="w-11 h-11 shrink-0 text-split text-base">{playing ? '⏸' : '▶'}</button>
            <input type="range" min={0} max={data.points.length - 1} value={cursor ?? 0} aria-label="Position in the paddle"
              onChange={e => { setCursor(Number(e.target.value)); setPlaying(false) }} className="flex-1 min-w-0 accent-split" />
            <span className="text-xs text-muted tabular whitespace-nowrap">
              {fmtClock(cur?.t ?? 0)}
              {cur && cur.speed > 0 && split500(cur.speed) !== '—' && <> · {split500(cur.speed)}/500</>}
              {cur?.sr != null && <> · {Math.round(cur.sr)} spm</>}
            </span>
          </div>
        )}
      </section>}

      {/* Phone: what it was, then what you can do, then the rest to read.
          Desktop: the actions in a column beside it all. */}
      <div className="flex-1 px-4 py-6 sm:py-8 max-w-5xl mx-auto w-full grid gap-6 md:gap-x-10 md:grid-cols-[minmax(0,1fr)_260px] md:grid-rows-[auto_1fr] content-start">
        {/* what this paddle was */}
        <div className="flex flex-col gap-4 min-w-0 md:col-start-1 md:row-start-1">
          <PageHeader title={paddled || 'A paddle'}
            eyebrow={[source, boatBadge].filter(Boolean).join(' · ') || undefined} />
          {(highlights.length > 0 || (owner && hiddenFromBuddies)) && (
            <ul className="flex flex-wrap gap-1.5 -mt-1" aria-label="Highlights">
              {highlights.map(h => <li key={h} className={badgeClass('split')}>{h}</li>)}
              {owner && hiddenFromBuddies && <span className={badgeClass('neutral')}>Hidden from buddies</span>}
            </ul>
          )}
          <div className={`${cardClass} p-4 grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-5`}>
            {motionOnly && data.noGps ? (
              <>
                <Stat label="Paddling" value={fmtClock(data.durationS)} sub="from the boat's motion" />
                <Stat label="Distance" value="—" sub="no GPS" />
                <Stat label="Stroke rate" value={data.avgSR != null ? `${Math.round(data.avgSR)}` : '—'} sub="spm" />
                <Stat label="Strokes" value={roundStrokes(data.noGps.strokes)} sub="about" />
              </>
            ) : (
              <>
                <Stat label="Time" value={fmtClock(data.durationS)} />
                <Stat label="Distance" value={`${data.distanceKm.toFixed(2)} km`} />
                <Stat label="Pace" value={`${split500(data.cruiseSpeed)}`} sub="/500, cruising" tone="primary" />
                <Stat label="Stroke rate" value={data.avgSR != null ? `${Math.round(data.avgSR)}` : '—'} sub={data.avgSR != null ? `spm${data.strokeRateDoubled ? ', doubled' : ''}` : 'not in this file'} tone="split" />
                <Stat label="Per stroke" value={data.avgDps != null ? `${data.avgDps.toFixed(1)} m` : '—'} />
              </>
            )}
            {c?.windKmh != null && (
              <Stat label="Wind" value={`${Math.round(c.windKmh)} km/h`}
                sub={<span className="inline-flex items-center gap-1"><WindRose dir={c.windDir ?? 0} /> from the {compass(c.windDir)}</span>} />
            )}
            {c?.flowM3s != null && <Stat label="River" value={<span className="text-flow">{c.flowM3s.toFixed(1)} m³/s</span>} sub={c.flowStation ? `at ${c.flowStation}` : undefined} />}
          </div>
          {motionOnly && data.noGps && <p className="text-sm text-muted">{noPaddleMessage(data.noGps.reason, true)}</p>}
        </div>

        {/* What you can do with it. Panels open in place, not over the map. */}
        <aside className="flex flex-col gap-3 md:col-start-2 md:row-start-1 md:row-span-2 md:sticky md:top-4 md:self-start" aria-label="Actions">
          <div className="flex flex-row flex-wrap md:flex-col gap-2">
            {onNewFile && <button type="button" onClick={onNewFile} className={buttonClass('secondary', 'md', ROW)}>Add another</button>}
            {readOnly && !buddy && <Link href="/" className={buttonClass('secondary', 'md', ROW)}>What is paddlesnitch?</Link>}
            {buddy && !motionOnly && (
              <ComparePicker label="Compare with one of mine" buddy className={buttonClass('secondary', 'md', ROW)}
                target={{ id: buddy.paddleId, owner: buddy.userId }}
                hrefFor={mine => `/paddles/compare?a=${mine}&b=${buddy.paddleId}&bOwner=${buddy.userId}`} />
            )}
            {owner && !motionOnly && (
              <ComparePicker label="Compare with…" buddy={false} className={buttonClass('secondary', 'md', ROW)}
                target={{ id: sessionId! }} hrefFor={other => `/paddles/compare?a=${sessionId}&b=${other}`} />
            )}
            {(owner || buddy) && !motionOnly && (
              <button type="button" onClick={() => (sectionMode ? exitSection() : (setSectionMode(true), window.scrollTo({ top: 0, behavior: 'smooth' })))}
                title="Pick part of this paddle to look at closely, or compare with your other paddles"
                aria-pressed={sectionMode}
                className={buttonClass('secondary', 'md', `${ROW} ${sectionMode ? 'border-split text-split' : ''}`)}>{sectionMode ? 'Stop picking' : 'Pick a section'}</button>
            )}
            {owner && <button type="button" onClick={() => setOpen(o => (o === 'notes' ? null : 'notes'))} aria-expanded={open === 'notes'} className={buttonClass('quiet', 'md', `${ROW} ${open === 'notes' ? 'bg-surface-2 text-fg' : ''}`)}>Notes</button>}
            {owner && <button type="button" onClick={() => setOpen(o => (o === 'boat' ? null : 'boat'))} aria-expanded={open === 'boat'} className={buttonClass('quiet', 'md', `${ROW} ${open === 'boat' ? 'bg-surface-2 text-fg' : ''}`)}>Boat{boatBadge ? ` · ${boatBadge}` : ''}</button>}
            {owner && (
              <button type="button" onClick={toggleShare} aria-expanded={showShare} className={buttonClass('quiet', 'md', `${ROW} ${showShare ? 'bg-surface-2 text-fg' : ''}`)}>
                <ShareIcon />Share
              </button>
            )}
            {owner && isTracker && <Link href={`/paddles/${sessionId}/motion`} className={buttonClass('quiet', 'md', ROW)}>Boat motion</Link>}
            {owner && (
              <button type="button" onClick={() => { setOpen(o => (o === 'more' ? null : 'more')); setConfirmDelete(false) }} aria-expanded={open === 'more'} aria-label="More actions"
                className={buttonClass('quiet', 'md', `${ROW} ${open === 'more' ? 'bg-surface-2 text-fg' : ''}`)}>
                <span aria-hidden className="text-lg leading-none">⋯</span><span className="md:inline hidden">More</span>
              </button>
            )}
          </div>

          {showShare && owner && (
            <div className={BOX}>
              <p className="text-sm text-muted">Anyone with the link can see this paddle.</p>
              {shareState === 'working' && !shareUrl ? (
                <p className="text-sm text-muted">Creating link…</p>
              ) : shareUrl ? (
                <>
                  <input readOnly value={shareUrl} onFocus={e => e.currentTarget.select()} aria-label="Share link" className={`${inputClass} text-sm`} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={copyShare} className={buttonClass('secondary', 'sm', 'flex-1')}>{shareState === 'copied' ? 'Copied' : 'Copy link'}</button>
                    <button type="button" onClick={downloadImage} className={buttonClass('secondary', 'sm', 'flex-1')}>Download image</button>
                  </div>
                  <p className="text-sm text-muted">Posts of this link show a map and stats. Download image saves that picture.</p>
                  {data.source?.type === 'strava' && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-border">
                      {data.source.stravaActivityId && (
                        <a href={`https://www.strava.com/activities/${data.source.stravaActivityId}`} target="_blank" rel="noopener noreferrer"
                          className={buttonClass('secondary', 'sm', 'text-strava')}>
                          Open my Strava activity ↗
                        </a>
                      )}
                      <p className="text-sm text-muted">Paste the link into your Strava description, and add the image as a photo.</p>
                    </div>
                  )}
                  <button type="button" onClick={stopSharing} disabled={shareState === 'working'} className={buttonClass('quiet', 'sm', 'self-start text-red hover:text-red')}>Stop sharing</button>
                </>
              ) : (
                <p className="text-sm text-red">Couldn&apos;t create a link. Close and try again.</p>
              )}
            </div>
          )}
          {open === 'notes' && owner && (
            <div className={BOX}>
              <label htmlFor="paddle-note" className="text-sm text-muted">How did it feel? Only you see this.</label>
              <textarea id="paddle-note" value={note} onChange={e => setNote(e.target.value)} rows={5}
                className={`${inputClass} py-2 resize-none`} placeholder="Catch felt sharp today; wind picked up on the way back…" />
              <button type="button" onClick={saveNote} disabled={noteState === 'saving'} className={buttonClass('secondary', 'sm')}>
                {noteState === 'saving' ? 'Saving…' : noteState === 'saved' ? 'Saved' : 'Save note'}
              </button>
            </div>
          )}
          {open !== 'notes' && note.trim() && !readOnly && <p className="text-sm text-muted border-l-2 border-border pl-3 whitespace-pre-line">{note}</p>}
          {open === 'boat' && owner && (
            <div className={BOX}>
              <Field label={<>Boat class {boatState === 'saving' ? <span className="text-muted font-normal">· saving…</span> : boatState === 'saved' ? <span className="text-muted font-normal">· saved</span> : ''}</>} htmlFor="boat-class">
                <select id="boat-class" value={boatClass} onChange={e => onBoatClass(e.target.value as BoatClass | '')} aria-label="Boat class" className={selectClass}>
                  <option value="">Not set</option>
                  <optgroup label="Kayak">{BOAT_CLASSES.filter(c => BOAT_CLASS_INFO[c].sport === 'kayak').map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                  <optgroup label="Rowing">{BOAT_CLASSES.filter(c => BOAT_CLASS_INFO[c].sport === 'rowing').map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                </select>
              </Field>
              {boatClass && BOAT_CLASS_INFO[boatClass].crewSize > 1 && (
                <Field label="Your seat" htmlFor="boat-seat">
                  <select id="boat-seat" value={seat === '' ? '' : String(seat)} onChange={e => onSeat(e.target.value === '' ? '' : (e.target.value === 'C' ? 'C' : Number(e.target.value)))}
                    className={selectClass}>
                    <option value="">Not set</option>
                    {expectedSeats(boatClass).map(s => <option key={String(s)} value={String(s)}>{seatLabel(boatClass, s)}</option>)}
                  </select>
                </Field>
              )}
              {/* The stroke-rate count belongs with the boat: kayak and SUP
                  files often count one stroke per left-and-right cycle. */}
              {dataProp.avgSR != null && (
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                  <span className="text-sm text-muted">Count each side (kayak and SUP files often count one per pair)</span>
                  <button type="button" onClick={toggleDouble} disabled={srSaving} aria-label="Double stroke rate" aria-pressed={srDoubled}
                    className={buttonClass(srDoubled ? 'primary' : 'secondary', 'sm', 'shrink-0')}>
                    {srDoubled ? 'On' : 'Off'}
                  </button>
                </div>
              )}
            </div>
          )}
          {open === 'more' && owner && (
            <div className={BOX}>
              <button type="button" onClick={() => setHidden.mutate({ id: sessionId!, hidden: !hiddenFromBuddies })} disabled={setHidden.isPending}
                className={buttonClass('quiet', 'md', 'justify-start w-full')} title="Your buddies see your paddles unless you hide one">
                {hiddenFromBuddies ? 'Show to buddies' : 'Hide from buddies'}
              </button>
              {confirmDelete ? (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-sm text-fg">Delete this paddle? This can&apos;t be undone.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={deletePaddle} disabled={delMut.isPending} className={buttonClass('danger', 'sm')}>{delMut.isPending ? 'Deleting…' : 'Delete'}</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className={buttonClass('quiet', 'sm')}>Keep</button>
                  </div>
                  {delMut.isError && <p className="text-sm text-red" role="alert">Couldn&apos;t delete this paddle. Please try again.</p>}
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className={buttonClass('quiet', 'md', 'justify-start w-full text-red hover:text-red')}>Delete paddle</button>
              )}
            </div>
          )}
        </aside>

        <div className="flex flex-col gap-8 min-w-0 md:col-start-1 md:row-start-2">
          {!motionOnly && <PaddleChart points={data.points} surges={data.surges} stops={data.stops} cursor={cursor}
            onSeek={i => { setCursor(i); setPlaying(false) }} />}

          <div className="border-l-2 border-primary pl-4">
            <p className="text-base leading-relaxed text-fg">{data.insight}</p>
            {summaryPending && <p className="text-sm text-muted mt-1" role="status">Writing your summary…</p>}
          </div>

          {sameOuting.length > 0 && (
            <div className="flex flex-col gap-1">
              {sameOuting.map(o => (
                <Link key={o.id} href={`/paddles/compare?a=${sessionId}&b=${o.id}`} className="text-sm text-primary-text hover:underline min-h-11 inline-flex items-center">
                  Also recorded by {o.sourceType === 'device' ? 'the tracker' : sourceName(o.sourceType)} →
                </Link>
              ))}
            </div>
          )}

          {(data.surges.length > 0 || data.stops.length > 0) && (
            <section aria-label="Efforts and rests" className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-fg">Efforts and rests</h2>
              {data.sets.some(s => s.count > 1) && (
                <div className="text-base">
                  <p className={`${eyebrowClass} mb-1`}>Repeats</p>
                  {data.sets.filter(s => s.count > 1).map((s, i) => (
                    <p key={i} className="tabular">{s.count} × {fmtDur(s.avgDurS)} at {split500(s.avgSpeed)}/500{s.avgSR != null ? `, ${Math.round(s.avgSR)} spm` : ''}</p>
                  ))}
                </div>
              )}
              {data.surges.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular">
                    <thead>
                      <tr className={`${eyebrowClass} text-left`}>
                        <th className="font-normal py-1 pr-3">#</th>
                        <th className="font-normal py-1 pr-3">At</th>
                        <th className="font-normal py-1 pr-3">For</th>
                        <th className="font-normal py-1 pr-3">/500</th>
                        <th className="font-normal py-1 pr-3">Spm</th>
                        <th className="font-normal py-1">How it went</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.surges.map((s, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-2 pr-3 text-muted">{i + 1}</td>
                          <td className="py-2 pr-3 text-muted">{fmtClock(s.fromT)}</td>
                          <td className="py-2 pr-3">{fmtDur(s.durS)}</td>
                          <td className="py-2 pr-3">{split500(s.avgSpeed)}</td>
                          <td className="py-2 pr-3">{s.avgSR != null ? Math.round(s.avgSR) : '—'}</td>
                          <td className="py-2 font-sans text-split">{s.trend ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.stops.length > 0 && (
                <p className="text-sm text-muted">
                  <span className={eyebrowClass + ' inline'}>RESTS </span>
                  {data.stops.map((s, i) => <span key={i} className="inline-block mr-3 tabular">{s.durS >= 60 ? fmtDur(s.durS) : `${Math.round(s.durS)} s`} at {fmtClock(s.fromT)}</span>)}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  )
}

// On a phone the actions sit in a wrapping row; beside the paddle on a
// computer they stack, full width and left aligned.
const ROW = 'md:w-full md:justify-start'
const BOX = `${cardClass} p-3 flex flex-col gap-3`
// Where a paddle came from, as a short label over the date.
const SOURCE: Record<string, string> = { strava: 'Strava', trial: 'Time trial', device: 'Tracker' }

function ShareIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 3v10M6 7l4-4 4 4M4 11v5a1 1 0 001 1h10a1 1 0 001-1v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Pick one of your paddles to compare with this one (yours or a buddy's): the
// server ranks them by the water you both covered the same way
// (paddles.comparable, route-match.ts) and offers only ones worth comparing.
function ComparePicker({ label, target, hrefFor, buddy, className }: {
  label: string
  target: { id: string; owner?: string }
  hrefFor: (myPaddleId: string) => string
  buddy: boolean
  className: string
}) {
  const [open, setOpen] = useState(false)
  const q = trpc.paddles.comparable.useQuery(target, { enabled: open, retry: false })
  const why = (p: { kind: string; sharedM: number }) =>
    p.kind === 'together' ? (buddy ? 'paddled together' : 'same outing')
      : p.kind === 'same_route' ? 'same route'
      : `${(p.sharedM / 1000).toFixed(1)} km shared`
  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`${className} ${open ? 'border-primary' : ''}`}>{label}</button>
      {open && (
        <div className={`${cardClass} basis-full p-1 max-h-72 overflow-y-auto text-sm`}>
          {q.isPending ? <p className="text-muted p-2">Finding paddles on the same water…</p>
            : q.isError ? <p className="text-red p-2">Couldn&apos;t load your paddles. Please try again.</p>
            : !q.data?.length ? <p className="text-muted p-2">None of your paddles shared enough of this water to compare.</p>
            : q.data.map(p => (
              <Link key={p.id} href={hrefFor(p.id)} className="flex items-center gap-2 min-h-11 px-2 rounded-[4px] hover:bg-surface-2">
                <span className="flex-1 min-w-0">
                  <span className="tabular text-fg">{fmtDay(p.paddledAt)} · {p.distanceKm.toFixed(1)} km</span>
                  <span className={p.kind === 'together' ? 'text-green' : 'text-muted'}> · {why(p)}</span>
                </span>
                <Chevron />
              </Link>
            ))}
        </div>
      )}
    </>
  )
}
