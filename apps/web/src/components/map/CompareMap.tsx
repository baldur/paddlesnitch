'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import { useEffect } from 'react'

type LL = [number, number]
const DARK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ATTR = 'Tiles &copy; Esri'
import { A_LINE, B_LINE } from './compare-colours'

function Fit({ pts }: { pts: LL[] }) {
  const map = useMap()
  useEffect(() => {
    if (!pts.length) return
    const lat = pts.map(p => p[0]), lng = pts.map(p => p[1])
    map.fitBounds([[Math.min(...lat), Math.min(...lng)], [Math.max(...lat), Math.max(...lng)]], { padding: [30, 30] })
  }, [map, pts])
  return null
}

function Clicks({ onPick }: { onPick?: (ll: LL) => void }) {
  useMapEvents({ click: e => onPick?.([e.latlng.lat, e.latlng.lng]) })
  return null
}

// Two paddles' lines on one map, the replay boats, an optional highlight (the
// widest gap) and the gates of a chosen stretch. Taps report where, so the
// page can pick a stretch on A's line.
export default function CompareMap({ a, b, boatA, boatB, highlight, gates, picks, onPick }: {
  a: LL[]; b: LL[]
  boatA?: LL | null; boatB?: LL | null
  highlight?: LL[]
  gates?: LL[][]
  picks?: LL[]
  onPick?: (ll: LL) => void
}) {
  return (
    <MapContainer center={a[0] ?? [51.5, -1]} zoom={14} style={{ height: '100%', width: '100%', background: '#0b1220' }} zoomControl>
      <TileLayer url={DARK} attribution={ATTR} maxNativeZoom={16} maxZoom={19} />
      <Fit pts={[...a, ...b]} />
      <Clicks onPick={onPick} />
      <Polyline positions={a} pathOptions={{ color: A_LINE, weight: 3, opacity: 0.9 }} />
      <Polyline positions={b} pathOptions={{ color: B_LINE, weight: 3, opacity: 0.9, dashArray: '6 4' }} />
      {highlight && highlight.length > 1 && <Polyline positions={highlight} pathOptions={{ color: '#facc15', weight: 9, opacity: 0.35 }} />}
      {gates?.map((g, i) => <Polyline key={i} positions={g} pathOptions={{ color: i === 0 ? '#22c55e' : '#ef4444', weight: 4 }} />)}
      {picks?.map((p, i) => <CircleMarker key={i} center={p} radius={6} pathOptions={{ color: '#facc15', fillOpacity: 1 }} />)}
      {boatA && <CircleMarker center={boatA} radius={7} pathOptions={{ color: '#0b1220', fillColor: A_LINE, fillOpacity: 1, weight: 2 }} />}
      {boatB && <CircleMarker center={boatB} radius={7} pathOptions={{ color: '#0b1220', fillColor: B_LINE, fillOpacity: 1, weight: 2 }} />}
    </MapContainer>
  )
}
