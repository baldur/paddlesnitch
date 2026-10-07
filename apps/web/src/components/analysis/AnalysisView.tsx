'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo, useRef } from 'react'
import AnalysisMapClient from '@/components/map/AnalysisMapClient'
import AppHeader from '@/components/AppHeader'
import { ramp, scaleBounds } from '@/components/map/colour-scale'
import type { AnalysisResult } from '@paddlesnitch/analysis/analysis'
import { fmtDur, fmtClock, split500, rescaleDoubling } from '@paddlesnitch/analysis/analysis'
import { gateAt, type Racer } from '@paddlesnitch/analysis/similar'
import { haversine } from '@paddlesnitch/timing/geo'
import { BOAT_CLASSES, BOAT_CLASS_INFO, expectedSeats, seatLabel, type BoatClass, type Seat } from '@paddlesnitch/core/types'
import { sourceLabel } from '@paddlesnitch/core/paddles'
import { trpc } from '@/lib/trpc'
import { sourceName } from './SameOuting'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (d?: number) => (d == null ? '' : COMPASS[Math.round(d / 45) % 8])
const PANEL = 'bg-surface/95 border border-border backdrop-blur-sm'

function WindRose({ dir }: { dir: number }) {
  const a = ((dir + 180) * Math.PI) / 180
  const x = Math.sin(a) * 9, y = -Math.cos(a) * 9
  return (
    <svg width="26" height="26" viewBox="-13 -13 26 26" className="inline-block align-middle">
      <circle r="12" fill="#0b1220" stroke="#1e293b" />
      <line x1={-x} y1={-y} x2={x} y2={y} stroke="#a78bfa" strokeWidth="2" />
      <circle cx={x} cy={y} r="3" fill="#a78bfa" />
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
export default function AnalysisView({ data: dataProp, sessionId, initialNote = '', initialBoatClass, initialSeat, onNewFile, readOnly = false }: {
  data: ViewData
  sessionId?: string
  initialNote?: string
  initialBoatClass?: BoatClass
  initialSeat?: Seat
  onNewFile?: () => void
  // Public shared view: hide the owner-only "PADDLES" link and show a
  // "analyse your own" call to action instead (#202).
  readOnly?: boolean
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const setDoublingMut = trpc.paddles.setDoubling.useMutation()
  const setNoteMut = trpc.paddles.setNote.useMutation()
  const shareMut = trpc.paddles.share.useMutation()
  const highlights = trpc.paddles.highlights.useQuery({ id: sessionId ?? '' }, { enabled: !!sessionId && !readOnly, retry: false }).data ?? []
  const sameOuting = trpc.paddles.sameOuting.useQuery({ id: sessionId ?? '' }, { enabled: !!sessionId && !readOnly, retry: false }).data ?? []
  const unshareMut = trpc.paddles.unshare.useMutation()
  const setBoatMut = trpc.paddles.setBoat.useMutation()
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
  const [showDiary, setShowDiary] = useState(false)
  // Boat metadata — the boat class + which seat the paddler was in.
  const [boatClass, setBoatClass] = useState<BoatClass | ''>(initialBoatClass ?? '')
  const [seat, setSeat] = useState<Seat | ''>(initialSeat ?? '')
  const [showBoat, setShowBoat] = useState(false)
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
  const paddled = data.paddledAt ? new Date(data.paddledAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const fmtMatchDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }

  const cur = data.points[cursor ?? 0]
  const scale = scaleBounds(data.points, metric)
  // A pace too slow to read as /500 (a drift, a turn) shows as "slower".
  const paceOr = (speed: number, fallback: string) => { const p = split500(speed); return p === '—' ? fallback : p }
  const scaleLabel = (v: number, end: 'lo' | 'hi') => (metric === 'speed' ? `${paceOr(v, end === 'lo' ? 'slower' : 'faster')}${split500(v) === '—' ? '' : '/500'}` : `${Math.round(v)} spm`)
  const isTracker = data.source?.type === 'device'

  return (
    <main className="flex-1 flex flex-col bg-bg text-fg">
      <AppHeader breadcrumb={readOnly
        ? <span className="text-muted text-xs tracking-widest">SHARED PADDLE</span>
        : <Link href="/paddles" className="tt-nav-link text-sm shrink-0">← PADDLES</Link>} />

      {/* The map, with only what belongs on a map over it: the colour scale,
          the replay bar, and picking a section. Everything to read is below. */}
      <section className="relative h-[52vh] min-h-[300px] max-h-[640px] border-b border-border" aria-label="Map">
        <div className="absolute inset-0">
          <AnalysisMapClient points={data.points} stops={data.stops} surges={data.surges} metric={metric} cursor={cursor}
            pickMode={sectionMode} onPick={onPick} startLine={startLine} finishLine={finishLine}
            markA={aIdx != null ? { lat: pts[aIdx].lat, lng: pts[aIdx].lng } : null}
            markB={bIdx != null ? { lat: pts[bIdx].lat, lng: pts[bIdx].lng } : null} />
        </div>

        {!sectionMode && (
          <div className={`${PANEL} absolute top-3 right-3 z-[1000] p-1.5 flex flex-col gap-1`}>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted tracking-widest px-1">COLOUR</span>
              {(['speed', 'sr'] as const).map(m => (
                <button key={m} onClick={() => setMetric(m)} disabled={m === 'sr' && dataProp.avgSR == null}
                  className={`px-2 py-1 text-[10px] tracking-widest disabled:opacity-30 ${metric === m ? 'bg-primary text-white' : 'text-muted hover:text-fg'}`}>
                  {m === 'speed' ? 'SPEED' : 'RATE'}
                </button>
              ))}
            </div>
            {scale && (
              <div className="px-1" aria-label="Colour scale">
                <div className="h-1.5" style={{ background: `linear-gradient(to right, ${[0, 0.4, 0.7, 1].map(ramp).join(',')})` }} />
                <div className="flex justify-between text-[9px] text-muted tabular mt-0.5">
                  <span>{scaleLabel(scale.lo, 'lo')}</span><span>{scaleLabel(scale.hi, 'hi')}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* section match list */}
        {sectionMode && findState === 'done' && (
          <div className={`${PANEL} absolute top-3 right-3 z-[1000] p-2 w-[min(300px,calc(100vw-1.5rem))] max-h-[40vh] overflow-auto`}>
            <div className="text-[10px] text-muted tracking-widest mb-1">
              {matches.length ? `${matches.length} OTHER ${matches.length === 1 ? 'PADDLE COVERS' : 'PADDLES COVER'} THIS SECTION` : 'NO OTHER PADDLES COVER THIS SECTION'}
            </div>
            {matches.map(m => {
              const on = selected.has(m.sessionId)
              return (
                <label key={m.sessionId} className={`flex items-center gap-2 py-1 px-1 cursor-pointer text-xs ${on ? 'bg-primary/20' : 'hover:bg-surface-2'}`}>
                  <input type="checkbox" checked={on} onChange={() => setSelected(s => { const n = new Set(s); n.has(m.sessionId) ? n.delete(m.sessionId) : n.add(m.sessionId); return n })} className="accent-primary" />
                  <span className="flex-1 min-w-0">
                    <span className="text-fg">{fmtMatchDate(m.paddledAt)}</span>
                    <span className="text-muted"> · {Math.round(m.score * 100)}% same route</span>
                  </span>
                  <span className="tabular text-muted">{fmtDur(m.elapsedS)} · {split500(m.cruiseSpeed)}/500</span>
                </label>
              )
            })}
            {matches.length > 0 && (
              <button onClick={raceSelected} disabled={selected.size === 0}
                className="mt-2 w-full px-3 py-1.5 text-[10px] tracking-widest bg-primary text-white disabled:opacity-40">
                RACE SELECTED ({selected.size}) →
              </button>
            )}
          </div>
        )}

        {/* bottom: replay bar, OR the section-picking panel */}
        {sectionMode ? (
          <div className={`${PANEL} absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] p-3 w-[min(520px,calc(100vw-1.5rem))] text-xs`}>
            <div className="text-[10px] text-split tracking-widest mb-1">PICK A SECTION</div>
            <div className="text-fg leading-relaxed">
              {aIdx == null && 'Tap where the section starts on your track.'}
              {aIdx != null && bIdx == null && 'Now tap where it ends.'}
              {aIdx != null && bIdx != null && (
                <span>Section: <b className="tabular text-fg">{(sectionM / 1000).toFixed(2)} km</b>, <span className="text-green">start</span> to <span className="text-red">finish</span>. Look at it closely, or compare it with your other paddles.</span>
              )}
            </div>
            {sectionErr && <div className="text-red mt-1">{sectionErr}</div>}
            {sectionInsight && <div className="mt-2 border-l-2 border-split pl-2 text-fg leading-relaxed">{sectionInsight.text}</div>}
            <div className="flex gap-2 mt-2 flex-wrap">
              <button onClick={analyseSection} disabled={aIdx == null || bIdx == null || insightLoading}
                className="px-3 py-1.5 text-[10px] tracking-widest bg-primary text-white disabled:opacity-40">
                {insightLoading ? 'ANALYSING…' : sectionInsight ? 'ANALYSE AGAIN' : 'ANALYSE THIS SECTION'}
              </button>
              <button onClick={findSimilar} disabled={aIdx == null || bIdx == null || findState === 'loading'}
                className="px-3 py-1.5 text-[10px] tracking-widest border border-primary text-fg disabled:opacity-40">
                {findState === 'loading' ? 'SEARCHING…' : 'COMPARE WITH OTHER PADDLES →'}
              </button>
              {(aIdx != null || bIdx != null) && <button onClick={resetSection} className="px-3 py-1.5 text-[10px] tracking-widest text-muted hover:text-fg border border-border">RESET</button>}
              <button onClick={exitSection} className="px-3 py-1.5 text-[10px] tracking-widest text-muted hover:text-fg border border-border">DONE</button>
            </div>
          </div>
        ) : (
          <div className={`${PANEL} absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] p-2 flex items-center gap-3 w-[min(520px,calc(100vw-1.5rem))]`} aria-label="Replay">
            <button onClick={() => { if (cursor == null || cursor >= data.points.length - 1) setCursor(0); setPlaying(p => !p) }}
              aria-label={playing ? 'Pause' : 'Play'} className="text-sm w-6 text-split">{playing ? '⏸' : '▶'}</button>
            <input type="range" min={0} max={data.points.length - 1} value={cursor ?? 0} aria-label="Position in the paddle"
              onChange={e => { setCursor(Number(e.target.value)); setPlaying(false) }} className="flex-1 min-w-0 accent-split" />
            <span className="text-[11px] text-muted tabular whitespace-nowrap">
              {fmtClock(cur?.t ?? 0)}
              {cur && cur.speed > 0 && split500(cur.speed) !== '—' && <> · {split500(cur.speed)}/500</>}
              {cur?.sr != null && <> · {Math.round(cur.sr)} spm</>}
            </span>
          </div>
        )}
      </section>

      <div className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full grid gap-8 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-6 min-w-0 order-2 md:order-1">
          {/* what this paddle was */}
          <div>
            <div className="text-[10px] text-muted tracking-widest">
              {paddled.toUpperCase()}{sourceLabel(data.source?.type)}{boatBadge && <span className="text-split"> · {boatBadge}</span>}
            </div>
            {highlights.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Highlights">
                {highlights.map(h => <li key={h} className="text-[11px] text-split border border-split/40 px-2 py-0.5">{h}</li>)}
              </ul>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
              <Stat label="Time" value={fmtClock(data.durationS)} />
              <Stat label="Distance" value={`${data.distanceKm.toFixed(2)} km`} />
              <Stat label="Pace" value={`${split500(data.cruiseSpeed)}`} note="/500, cruising" />
              <Stat label="Stroke rate" value={data.avgSR != null ? `${Math.round(data.avgSR)}` : '—'} note={data.avgSR != null ? `spm${data.strokeRateDoubled ? ', doubled' : ''}` : 'not in this file'} />
              <Stat label="Per stroke" value={data.avgDps != null ? `${data.avgDps.toFixed(1)} m` : '—'} />
            </div>
            {(c?.windKmh != null || c?.flowM3s != null) && (
              <div className="flex items-center gap-4 mt-3 text-sm text-fg tabular flex-wrap">
                {c?.windKmh != null && <span className="flex items-center gap-1"><WindRose dir={c.windDir ?? 0} /> wind {Math.round(c.windKmh)} km/h {compass(c.windDir)}</span>}
                {c?.flowM3s != null && <span className="text-[#22d3ee]">river {c.flowM3s.toFixed(1)} m³/s{c.flowStation ? ` at ${c.flowStation}` : ''}</span>}
              </div>
            )}
          </div>

          <p className="leading-relaxed text-fg border-l-2 border-primary pl-3">{data.insight}</p>

          {sameOuting.length > 0 && (
            <div className="flex flex-col gap-1">
              {sameOuting.map(o => (
                <Link key={o.id} href={`/paddles/compare?a=${sessionId}&b=${o.id}`} className="text-sm text-primary">
                  ALSO RECORDED BY {o.sourceType === 'device' ? 'THE TRACKER' : sourceName(o.sourceType)} →
                </Link>
              ))}
            </div>
          )}

          {(data.surges.length > 0 || data.stops.length > 0) && (
            <section aria-label="Efforts and rests">
              <h2 className="text-xs text-muted tracking-widest mb-2">EFFORTS AND RESTS</h2>
              {data.sets.some(s => s.count > 1) && (
                <div className="mb-3 text-sm">
                  <div className="text-[10px] text-muted tracking-widest mb-1">REPEATS</div>
                  {data.sets.filter(s => s.count > 1).map((s, i) => (
                    <div key={i} className="tabular">{s.count} × {fmtDur(s.avgDurS)} at {split500(s.avgSpeed)}/500{s.avgSR != null ? `, ${Math.round(s.avgSR)} spm` : ''}</div>
                  ))}
                </div>
              )}
              {data.surges.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular">
                    <thead>
                      <tr className="text-[10px] text-muted tracking-widest text-left">
                        <th className="font-normal py-1 pr-3">#</th>
                        <th className="font-normal py-1 pr-3">AT</th>
                        <th className="font-normal py-1 pr-3">FOR</th>
                        <th className="font-normal py-1 pr-3">/500</th>
                        <th className="font-normal py-1 pr-3">SPM</th>
                        <th className="font-normal py-1">HOW IT WENT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.surges.map((s, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1.5 pr-3 text-muted">{i + 1}</td>
                          <td className="py-1.5 pr-3 text-muted">{fmtClock(s.fromT)}</td>
                          <td className="py-1.5 pr-3">{fmtDur(s.durS)}</td>
                          <td className="py-1.5 pr-3">{split500(s.avgSpeed)}</td>
                          <td className="py-1.5 pr-3">{s.avgSR != null ? Math.round(s.avgSR) : '—'}</td>
                          <td className="py-1.5 text-split text-xs">{s.trend ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.stops.length > 0 && (
                <div className="mt-3 text-xs text-muted">
                  <span className="tracking-widest text-[10px]">RESTS </span>
                  {data.stops.map((s, i) => <span key={i} className="inline-block mr-3 tabular">{s.durS >= 60 ? fmtDur(s.durS) : `${Math.round(s.durS)} s`} at {fmtClock(s.fromT)}</span>)}
                </div>
              )}
            </section>
          )}
        </div>

        {/* What you can do with it. Panels open in place, not over the map. */}
        <aside className="order-1 md:order-2 flex flex-row flex-wrap md:flex-col md:flex-nowrap gap-2 text-xs content-start" aria-label="Actions">
          {onNewFile && <button onClick={onNewFile} className={ACTION}>ADD ANOTHER</button>}
          {readOnly && <Link href="/" className={ACTION}>WHAT IS PADDLESNITCH? →</Link>}
          {sessionId && !readOnly && <button onClick={toggleShare} className={`${ACTION} ${showShare ? 'border-primary text-fg' : ''}`}>SHARE</button>}
          {showShare && sessionId && !readOnly && (
            <div className={BOX}>
              <div className="text-[10px] text-muted mb-1">Anyone with the link can see this paddle.</div>
              {shareState === 'working' && !shareUrl ? (
                <div className="text-xs text-muted">Creating link…</div>
              ) : shareUrl ? (
                <>
                  <input readOnly value={shareUrl} onFocus={e => e.currentTarget.select()} className="w-full text-xs bg-bg border border-border p-2 text-fg" />
                  <div className="flex gap-1 mt-1">
                    <button onClick={copyShare} className="flex-1 px-3 py-1.5 text-[10px] tracking-widest bg-primary text-white">{shareState === 'copied' ? 'COPIED' : 'COPY LINK'}</button>
                    <button onClick={stopSharing} disabled={shareState === 'working'} className="px-3 py-1.5 text-[10px] tracking-widest text-red border border-border disabled:opacity-40">STOP SHARING</button>
                  </div>
                  <button onClick={downloadImage} className="w-full mt-1 px-3 py-1.5 text-[10px] tracking-widest text-muted border border-border hover:text-fg hover:border-primary">DOWNLOAD IMAGE</button>
                  <div className="text-[10px] text-muted mt-1 leading-snug">Posts of this link show a map and stats. DOWNLOAD IMAGE saves that picture.</div>
                  {data.source?.type === 'strava' && (
                    <div className="mt-2 pt-2 border-t border-border">
                      {data.source.stravaActivityId && (
                        <a href={`https://www.strava.com/activities/${data.source.stravaActivityId}`} target="_blank" rel="noopener noreferrer"
                          className="block w-full px-3 py-1.5 text-[10px] tracking-widest text-center text-[#fc4c02] border border-border hover:border-[#fc4c02]">
                          OPEN MY STRAVA ACTIVITY ↗
                        </a>
                      )}
                      <div className="text-[10px] text-muted mt-1 leading-snug">Paste the link into your Strava description, and add the image as a photo.</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-red">Couldn&apos;t create a link. Close and try again.</div>
              )}
            </div>
          )}
          {sessionId && !readOnly && <button onClick={() => setShowDiary(s => !s)} className={`${ACTION} ${showDiary ? 'border-primary text-fg' : ''}`}>NOTES</button>}
          {showDiary && sessionId && !readOnly && (
            <div className={BOX}>
              <div className="text-[10px] text-muted mb-1">How did it feel? Only you see this.</div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={5}
                className="w-full text-xs bg-bg border border-border p-2 text-fg resize-none" placeholder="Catch felt sharp today; wind picked up on the way back…" />
              <button onClick={saveNote} disabled={noteState === 'saving'} className="mt-1 w-full px-3 py-1.5 text-[10px] tracking-widest bg-primary text-white disabled:opacity-40">
                {noteState === 'saving' ? 'SAVING…' : noteState === 'saved' ? 'SAVED' : 'SAVE NOTE'}
              </button>
            </div>
          )}
          {!showDiary && note.trim() && !readOnly && <p className="basis-full text-xs text-muted border-l-2 border-border pl-2 whitespace-pre-line">{note}</p>}
          {sessionId && !readOnly && <button onClick={() => setShowBoat(s => !s)} className={`${ACTION} ${showBoat ? 'border-primary text-fg' : ''}`}>BOAT{boatBadge ? ` · ${boatBadge}` : ''}</button>}
          {showBoat && sessionId && !readOnly && (
            <div className={BOX}>
              <div className="text-[10px] text-muted tracking-widest mb-1">BOAT CLASS {boatState === 'saving' ? '· saving…' : boatState === 'saved' ? '· saved' : ''}</div>
              <select value={boatClass} onChange={e => onBoatClass(e.target.value as BoatClass | '')} aria-label="Boat class"
                className="w-full text-xs bg-bg border border-border p-1.5 text-fg mb-2">
                <option value="">— not set —</option>
                <optgroup label="Kayak">{BOAT_CLASSES.filter(c => BOAT_CLASS_INFO[c].sport === 'kayak').map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                <optgroup label="Rowing">{BOAT_CLASSES.filter(c => BOAT_CLASS_INFO[c].sport === 'rowing').map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              </select>
              {boatClass && BOAT_CLASS_INFO[boatClass].crewSize > 1 && (
                <>
                  <label className="block text-[10px] text-muted mb-0.5">Your seat</label>
                  <select value={seat === '' ? '' : String(seat)} onChange={e => onSeat(e.target.value === '' ? '' : (e.target.value === 'C' ? 'C' : Number(e.target.value)))}
                    className="w-full text-xs bg-bg border border-border p-1.5 text-fg mb-2">
                    <option value="">— not set —</option>
                    {expectedSeats(boatClass).map(s => <option key={String(s)} value={String(s)}>{seatLabel(boatClass, s)}</option>)}
                  </select>
                </>
              )}
              {/* The stroke-rate count belongs with the boat: kayak and SUP
                  files often count one stroke per left-and-right cycle. */}
              {dataProp.avgSR != null && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                  <span className="text-[10px] text-muted leading-snug">Count each side (kayak and SUP files often count one per pair)</span>
                  <button onClick={toggleDouble} disabled={srSaving} aria-label="Double stroke rate"
                    className={`px-2 py-1 text-[10px] tracking-widest border border-border disabled:opacity-50 ${srDoubled ? 'bg-primary text-white' : 'text-muted hover:text-fg'}`}>
                    {srDoubled ? 'ON' : 'OFF'}
                  </button>
                </div>
              )}
            </div>
          )}
          {sessionId && !readOnly && isTracker && <Link href={`/paddles/${sessionId}/motion`} className={ACTION}>BOAT MOTION →</Link>}
          {sessionId && !readOnly && (
            <button onClick={() => (sectionMode ? exitSection() : (setSectionMode(true), window.scrollTo({ top: 0, behavior: 'smooth' })))}
              title="Pick part of this paddle to look at closely, or compare with your other paddles"
              className={`${ACTION} ${sectionMode ? 'border-split text-split' : ''}`}>{sectionMode ? 'STOP PICKING A SECTION' : 'PICK A SECTION'}</button>
          )}
        </aside>
      </div>
    </main>
  )
}

const ACTION = 'md:w-full text-left px-3 py-2 text-[11px] tracking-widest text-muted border border-border hover:border-primary hover:text-fg'
const BOX = 'basis-full border border-border bg-surface p-2'

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-border bg-surface px-3 py-2 min-w-0">
      <div className="text-[9px] text-muted tracking-widest uppercase">{label}</div>
      <div className="text-lg text-fg tabular truncate">{value}</div>
      {note && <div className="text-[10px] text-muted truncate">{note}</div>}
    </div>
  )
}
