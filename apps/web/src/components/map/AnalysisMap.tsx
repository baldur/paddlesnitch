'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useEffect } from 'react'
import type { AnalysisPoint, Segment } from '@paddlesnitch/analysis/analysis'
import { split500 } from '@paddlesnitch/analysis/analysis'
import { ramp, quantile as q } from './colour-scale'

// Esri Dark Gray Canvas — keyless raster. (CARTO's free basemaps now serve an
// "API key required" nag tile once over their informal limit.) Native tiles cap
// at z16; maxNativeZoom on the layer upscales beyond so it still zooms to 19.
const DARK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ATTR = 'Tiles &copy; Esri'

type LL = [number, number]
export type SectionOverlay = {
  pickMode?: boolean
  onPick?: (lat: number, lng: number) => void
  startLine?: LL[] | null
  finishLine?: LL[] | null
  markA?: { lat: number; lng: number } | null
  markB?: { lat: number; lng: number } | null
}

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function Fit({ pts }: { pts: AnalysisPoint[] }) {
  const map = useMap()
  useEffect(() => {
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng)
    // A margin in proportion to the map: 70 px on all sides left a phone's
    // map showing the route as a smudge in the middle.
    const size = map.getSize()
    const pad = Math.round(Math.min(70, Math.min(size.x, size.y) * 0.08))
    map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [pad, pad] })
  }, [map, pts])
  return null
}

export default function AnalysisMap({ points, stops, surges, metric, cursor, pickMode, onPick, startLine, finishLine, markA, markB }: { points: AnalysisPoint[]; stops: Segment[]; surges: Segment[]; metric: 'speed' | 'sr'; cursor?: number | null } & SectionOverlay) {
  const vals = points.map(p => (metric === 'speed' ? p.speed : p.sr)).filter((v): v is number => v != null && v > 0)
  const lo = q(vals, 10), hi = q(vals, 90)
  const nearest = (t: number) => points.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), points[0])
  const cur = cursor != null && cursor >= 0 && cursor < points.length ? points[cursor] : null

  return (
    <MapContainer center={[points[0].lat, points[0].lng]} zoom={14} style={{ height: '100%', width: '100%', background: '#0b1220', cursor: pickMode ? 'crosshair' : undefined }} zoomControl>
      <TileLayer url={DARK} attribution={ATTR} maxNativeZoom={16} maxZoom={19} />
      <Fit pts={points} />
      {pickMode && onPick && <ClickCapture onPick={onPick} />}
      {points.slice(1).map((p, i) => {
        const v = metric === 'speed' ? p.speed : p.sr
        const color = v == null ? '#475569' : ramp((v - lo) / (hi - lo || 1))
        return (
          <Polyline key={i} positions={[[points[i].lat, points[i].lng], [p.lat, p.lng]]} pathOptions={{ color, weight: 4, opacity: 0.95 }}>
            <Tooltip sticky>{fmt(p.t)} · {p.speed > 0 ? `${split500(p.speed)}/500` : 'stopped'}{p.sr != null ? ` · ${Math.round(p.sr)} spm` : ''}</Tooltip>
          </Polyline>
        )
      })}
      {surges.map((s, i) => { const p = nearest((s.fromT + s.toT) / 2); return <CircleMarker key={`s${i}`} center={[p.lat, p.lng]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillOpacity: 0 }}><Tooltip>effort {i + 1} · {fmt(s.durS)}{s.avgSR != null ? ` · ${Math.round(s.avgSR)} spm` : ''}{s.trend ? ` · ${s.trend}` : ''}</Tooltip></CircleMarker> })}
      {stops.map((s, i) => { const p = nearest(s.fromT); return <CircleMarker key={`r${i}`} center={[p.lat, p.lng]} radius={7} pathOptions={{ color: '#38bdf8', weight: 2, fillOpacity: 0 }}><Tooltip>rest {Math.round(s.durS)}s</Tooltip></CircleMarker> })}
      <CircleMarker center={[points[0].lat, points[0].lng]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }}><Tooltip>start</Tooltip></CircleMarker>
      <CircleMarker center={[points[points.length - 1].lat, points[points.length - 1].lng]} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }}><Tooltip>finish</Tooltip></CircleMarker>
      {cur && <CircleMarker center={[cur.lat, cur.lng]} radius={8} pathOptions={{ color: '#fff', fillColor: '#a78bfa', fillOpacity: 1, weight: 2 }} />}
      {startLine && <Polyline positions={startLine} pathOptions={{ color: '#22c55e', weight: 4, opacity: 0.9 }} />}
      {finishLine && <Polyline positions={finishLine} pathOptions={{ color: '#ef4444', weight: 4, opacity: 0.9 }} />}
      {markA && <CircleMarker center={[markA.lat, markA.lng]} radius={7} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}><Tooltip>start</Tooltip></CircleMarker>}
      {markB && <CircleMarker center={[markB.lat, markB.lng]} radius={7} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}><Tooltip>finish</Tooltip></CircleMarker>}
    </MapContainer>
  )
}
