'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMapEvents, useMap } from 'react-leaflet'
import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import type { LatLng, Line } from '@/lib/types'
import RiverLayer from './RiverLayer'

const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
}
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

type CourseTypeInput = 'point_to_point' | 'loop' | 'gate'

type GateEntry = { pts: LatLng[]; direction: 1 | -1 }

type MapState = {
  startLine?: Line
  finishLine?: Line
  gateDirection?: 1 | -1
  gates?: Array<{ line: Line; direction: 1 | -1 }>
}

type Props = {
  onChange: (state: MapState) => void
  defaultCenter?: LatLng
  courseType?: CourseTypeInput
  // Initial geometry — only used on first mount, so the consumer can
  // hand us an existing course to edit. Subsequent prop changes don't
  // overwrite user edits (DrawingMap is the source of truth once
  // mounted). Used by the edit-course admin page (#58).
  initialStartLine?: Line
  initialFinishLine?: Line
  initialGates?: Array<{ line: Line; direction: 1 | -1 }>
}

function ClickHandler({ onMapClick }: { onMapClick: (pt: LatLng) => void }) {
  useMapEvents({ click(e: L.LeafletMouseEvent) { onMapClick([e.latlng.lat, e.latlng.lng]) } })
  return null
}

const READING: LatLng = [51.4543, -0.9781]

function GeolocateCenter({ disabled }: { disabled?: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (disabled) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => {}
    )
  }, [map, disabled])
  return null
}

// Arrow pointing from gate midpoint toward the active crossing side
function DirectionArrow({ line, direction, color }: { line: Line; direction: 1 | -1; color: string }) {
  const [A, B] = line
  const dlat = B[0] - A[0], dlng = B[1] - A[1]
  const len = Math.sqrt(dlat * dlat + dlng * dlng)
  const mid: LatLng = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
  const nLat = (dlng / len) * direction, nLng = (-dlat / len) * direction
  const tLat = dlat / len, tLng = dlng / len
  const shaft = len * 0.65, head = len * 0.28, spread = len * 0.18
  const tip: LatLng = [mid[0] + nLat * shaft, mid[1] + nLng * shaft]
  const h1: LatLng = [tip[0] - nLat * head + tLat * spread, tip[1] - nLng * head + tLng * spread]
  const h2: LatLng = [tip[0] - nLat * head - tLat * spread, tip[1] - nLng * head - tLng * spread]
  return (
    <>
      <Polyline positions={[mid, tip]} pathOptions={{ color, weight: 4, opacity: 1 }} />
      <Polyline positions={[tip, h1]} pathOptions={{ color, weight: 4, opacity: 1 }} />
      <Polyline positions={[tip, h2]} pathOptions={{ color, weight: 4, opacity: 1 }} />
    </>
  )
}

function directionLabel(line: Line, dir: 1 | -1): string {
  const [A, B] = line
  const dlat = B[0] - A[0], dlng = B[1] - A[1]
  const len = Math.sqrt(dlat * dlat + dlng * dlng)
  const nLat = (dlng / len) * dir, nLng = (-dlat / len) * dir
  if (Math.abs(nLat) >= Math.abs(nLng)) return nLat > 0 ? '↑ N' : '↓ S'
  return nLng > 0 ? '→ E' : '← W'
}

// Color per gate index
function gateColor(index: number, total: number): string {
  if (index === 0) return '#15803d'          // start: green
  if (index === total - 1) return '#b91c1c'  // finish: red
  return '#d97706'                           // intermediate: amber
}

export default function DrawingMap({
  onChange,
  defaultCenter = READING,
  courseType = 'point_to_point',
  initialStartLine,
  initialFinishLine,
  initialGates,
}: Props) {
  const [mode, setMode] = useState<'start' | 'finish' | number | null>(null)
  const [startPts, setStartPts] = useState<LatLng[]>(initialStartLine ? [...initialStartLine] : [])
  const [finishPts, setFinishPts] = useState<LatLng[]>(initialFinishLine ? [...initialFinishLine] : [])
  const [gateEntries, setGateEntries] = useState<GateEntry[]>(
    initialGates && initialGates.length >= 2
      ? initialGates.map(g => ({ pts: [...g.line], direction: g.direction }))
      : [{ pts: [], direction: 1 }, { pts: [], direction: 1 }]
  )
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // When the user explicitly switches course type from the picker, wipe
  // the working state. Skipped on the very first render so initial lines
  // passed by the parent (edit mode) survive the mount.
  const firstTypeRender = useRef(true)
  useEffect(() => {
    if (firstTypeRender.current) {
      firstTypeRender.current = false
      return
    }
    setStartPts([]); setFinishPts([])
    setGateEntries([{ pts: [], direction: 1 }, { pts: [], direction: 1 }])
    setMode(null)
    onChange({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseType])

  const isTwoLine = courseType === 'point_to_point'
  const isGate = courseType === 'gate'

  // ── emit helpers ─────────────────────────────────────────────────────────────

  const emitSimple = (sp: LatLng[], fp: LatLng[]) => {
    onChange({
      startLine: sp.length === 2 ? (sp as Line) : undefined,
      ...(isTwoLine ? { finishLine: fp.length === 2 ? (fp as Line) : undefined } : {}),
    })
  }

  const emitGates = (entries: GateEntry[]) => {
    const complete = entries.every(g => g.pts.length === 2)
    if (!complete) { onChange({}); return }
    const gates = entries.map(g => ({ line: g.pts as Line, direction: g.direction }))
    onChange({ gates })
  }

  // On mount, push initial geometry up so the parent's form picks up
  // the existing course's lines without the user having to touch the
  // map. Skipped if no initial geometry was provided. eslint complains
  // about the missing onChange / state deps; intentional — we really
  // do only want this to fire once on mount, before the state-change
  // emitters take over.
  useEffect(() => {
    if (initialGates && initialGates.length >= 2) {
      emitGates(gateEntries)
    } else if (initialStartLine || initialFinishLine) {
      emitSimple(startPts, finishPts)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── click handler ─────────────────────────────────────────────────────────────

  const handleClick = (pt: LatLng) => {
    if (isGate) {
      if (typeof mode !== 'number') return
      setGateEntries(prev => {
        const next = prev.map((g, i) => {
          if (i !== mode) return g
          const pts = g.pts.length < 2 ? [...g.pts, pt] : [pt]
          return { ...g, pts }
        })
        if (next[mode as number].pts.length === 2) setMode(null)
        emitGates(next)
        return next
      })
    } else if (mode === 'start') {
      const next = startPts.length < 2 ? [...startPts, pt] : [pt]
      setStartPts(next)
      emitSimple(next, finishPts)
      if (next.length === 2) setMode(null)
    } else if (mode === 'finish') {
      const next = finishPts.length < 2 ? [...finishPts, pt] : [pt]
      setFinishPts(next)
      emitSimple(startPts, next)
      if (next.length === 2) setMode(null)
    }
  }

  // ── gate management ───────────────────────────────────────────────────────────

  const addGate = () => {
    setGateEntries(prev => {
      const next = [
        ...prev.slice(0, -1),
        { pts: [], direction: 1 as const },
        prev[prev.length - 1],
      ]
      emitGates(next)
      return next
    })
  }

  const removeGate = (index: number) => {
    if (mode === index) setMode(null)
    setGateEntries(prev => {
      const next = prev.filter((_, i) => i !== index)
      emitGates(next)
      return next
    })
  }

  const resetGate = (index: number) => {
    setGateEntries(prev => {
      const next = prev.map((g, i) => i === index ? { ...g, pts: [] } : g)
      emitGates(next)
      return next
    })
    setMode(index)
  }

  const flipGate = (index: number) => {
    setGateEntries(prev => {
      const next = prev.map((g, i) =>
        i === index ? { ...g, direction: (g.direction === 1 ? -1 : 1) as 1 | -1 } : g
      )
      emitGates(next)
      return next
    })
  }

  // ── simple (loop / p2p) resets ────────────────────────────────────────────────

  const resetStart = () => { setStartPts([]); setMode('start'); emitSimple([], finishPts) }
  const resetFinish = () => { setFinishPts([]); setMode('finish'); emitSimple(startPts, []) }

  if (!mounted) return <div style={{ height: 400 }} className="bg-surface border border-border" />

  const startDone = startPts.length === 2
  const finishDone = finishPts.length === 2
  const cursorStyle = mode !== null ? 'crosshair' : 'grab'

  return (
    <div className="flex flex-col gap-3">

      {/* ── Gate controls (multi-gate UI) ────────────────────────────────────── */}
      {isGate && (
        <div className="flex flex-col gap-1.5">
          {gateEntries.map((gate, i) => {
            const total = gateEntries.length
            const isStart = i === 0
            const isFinish = i === total - 1
            const color = gateColor(i, total)
            const done = gate.pts.length === 2
            const label = isStart ? 'START' : isFinish ? 'FINISH' : `GATE ${i}`
            return (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] tracking-widest font-bold w-14 shrink-0" style={{ color }}>
                  {label}
                </span>
                <button
                  type="button"
                  onClick={() => done ? resetGate(i) : setMode(mode === i ? null : i)}
                  className={`px-3 py-1 text-xs border transition-colors ${
                    mode === i
                      ? 'border-primary text-primary'
                      : done
                      ? 'border-muted text-muted opacity-70'
                      : 'border-border text-muted hover:border-primary hover:text-primary'
                  }`}
                >
                  {done
                    ? '✓ LINE (reset)'
                    : mode === i
                    ? `POINT ${gate.pts.length + 1}/2`
                    : 'SET LINE'}
                </button>
                {done && (
                  <button
                    type="button"
                    onClick={() => flipGate(i)}
                    className="px-3 py-1 text-xs border border-primary text-primary hover:bg-primary/10 transition-colors"
                  >
                    FLIP ⇄ {directionLabel(gate.pts as Line, gate.direction)}
                  </button>
                )}
                {!isStart && !isFinish && (
                  <button
                    type="button"
                    onClick={() => removeGate(i)}
                    className="px-2 py-1 text-xs border border-border text-muted hover:border-red hover:text-red transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}
          <button
            type="button"
            onClick={addGate}
            className="self-start px-3 py-1 text-xs border border-border text-muted hover:border-primary hover:text-primary transition-colors"
          >
            + ADD GATE
          </button>
        </div>
      )}

      {/* ── Simple controls (loop / point_to_point) ──────────────────────────── */}
      {!isGate && (
        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => startDone ? resetStart() : setMode(mode === 'start' ? null : 'start')}
            className={`px-3 py-1.5 text-xs border transition-colors ${
              mode === 'start'
                ? (isTwoLine ? 'border-green text-green' : 'border-split text-split')
                : startDone
                ? (isTwoLine ? 'border-green text-green opacity-70' : 'border-split text-split opacity-70')
                : (isTwoLine
                    ? 'border-border text-muted hover:border-green hover:text-green'
                    : 'border-border text-muted hover:border-split hover:text-split')
            }`}
          >
            {startDone
              ? `✓ ${isTwoLine ? 'START LINE' : 'CROSSING LINE'} (click to reset)`
              : mode === 'start' ? `PLACE POINT ${startPts.length + 1}/2`
              : `SET ${isTwoLine ? 'START LINE' : 'CROSSING LINE'}`}
          </button>
          {isTwoLine && (
            <button
              type="button"
              onClick={() => finishDone ? resetFinish() : setMode(mode === 'finish' ? null : 'finish')}
              className={`px-3 py-1.5 text-xs border transition-colors ${
                mode === 'finish' ? 'border-red text-red'
                  : finishDone ? 'border-red text-red opacity-70'
                  : 'border-border text-muted hover:border-red hover:text-red'
              }`}
            >
              {finishDone ? '✓ FINISH LINE (click to reset)' : mode === 'finish' ? `PLACE POINT ${finishPts.length + 1}/2` : 'SET FINISH LINE'}
            </button>
          )}
        </div>
      )}

      {/* ── Map ──────────────────────────────────────────────────────────────── */}
      <div className="relative" style={{ cursor: cursorStyle }}>
        <button
          onClick={() => setDark(d => !d)}
          className="absolute top-2 right-2 z-[1001] px-2 py-1 text-[10px] border bg-bg border-border text-muted hover:border-primary hover:text-primary transition-colors"
        >
          {dark ? 'LIGHT MAP' : 'DARK MAP'}
        </button>
        <MapContainer center={defaultCenter} zoom={14} style={{ height: 400, width: '100%' }}>
          <TileLayer url={TILES[dark ? 'dark' : 'light']} attribution={ATTRIBUTION} maxZoom={19} />
          <RiverLayer dark={dark} />
          {/* Skip auto-geolocate when editing — we want to stay centred
              on the existing course, not jump to wherever the browser is. */}
          <GeolocateCenter disabled={!!(initialStartLine || initialGates)} />
          <ClickHandler onMapClick={handleClick} />

          {/* Gate lines */}
          {isGate && gateEntries.map((gate, i) => {
            if (gate.pts.length === 0) return null
            const total = gateEntries.length
            const color = gateColor(i, total)
            const done = gate.pts.length === 2
            return (
              <span key={i}>
                {gate.pts.map((pt, j) => (
                  <CircleMarker key={j} center={pt} radius={5}
                    pathOptions={{ color, fillColor: color, fillOpacity: 1 }}
                  />
                ))}
                {done && (
                  <Polyline positions={gate.pts} pathOptions={{ color, weight: 3, dashArray: '8 4' }} />
                )}
                {done && (
                  <DirectionArrow line={gate.pts as Line} direction={gate.direction} color={color} />
                )}
              </span>
            )
          })}

          {/* Simple: start line / crossing line */}
          {!isGate && startPts.map((pt, i) => (
            <CircleMarker key={`s${i}`} center={pt} radius={6}
              pathOptions={{ color: isTwoLine ? '#15803d' : '#7c3aed', fillColor: isTwoLine ? '#15803d' : '#7c3aed', fillOpacity: 1 }}
            />
          ))}
          {!isGate && startDone && (
            <Polyline positions={startPts}
              pathOptions={{ color: isTwoLine ? '#15803d' : '#7c3aed', weight: 3, dashArray: isTwoLine ? undefined : '8 4' }}
            />
          )}

          {/* Simple: finish line (point_to_point only) */}
          {isTwoLine && finishPts.map((pt, i) => (
            <CircleMarker key={`f${i}`} center={pt} radius={6}
              pathOptions={{ color: '#b91c1c', fillColor: '#b91c1c', fillOpacity: 1 }}
            />
          ))}
          {isTwoLine && finishDone && (
            <Polyline positions={finishPts} pathOptions={{ color: '#b91c1c', weight: 3 }} />
          )}
        </MapContainer>
      </div>

      {mode !== null && !isGate && (
        <p className="text-xs text-muted">
          Click 2 points on the map to set the{' '}
          <span className={mode === 'start' ? (isTwoLine ? 'text-green' : 'text-split') : 'text-red'}>
            {mode === 'start' ? (isTwoLine ? 'start line' : 'crossing line') : 'finish line'}
          </span>. Pan/zoom with scroll and drag.
        </p>
      )}
      {isGate && typeof mode === 'number' && (
        <p className="text-xs text-muted">
          Click 2 points on the map to draw{' '}
          <span className="text-primary">
            {mode === 0 ? 'the start gate' : mode === gateEntries.length - 1 ? 'the finish gate' : `gate ${mode}`}
          </span>. Pan/zoom with scroll and drag.
        </p>
      )}
    </div>
  )
}
