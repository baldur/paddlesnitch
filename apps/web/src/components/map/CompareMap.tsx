'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { directionMarks, linesKey, MARKS_MIN_ZOOM } from './direction-marks'

type LL = [number, number]
const DARK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ATTR = 'Tiles &copy; Esri'
import { A_LINE, B_LINE } from './compare-colours'

// Fit the lines once, and again only when they change: the page re-renders on
// every replay tick and scrub, which must not undo the paddler's zoom.
function Fit({ lines }: { lines: LL[][] }) {
  const map = useMap()
  const key = linesKey(lines)
  useEffect(() => {
    const pts = lines.flat()
    if (!pts.length) return
    const lat = pts.map(p => p[0]), lng = pts.map(p => p[1])
    map.fitBounds([[Math.min(...lat), Math.min(...lng)], [Math.max(...lat), Math.max(...lng)]], { padding: [30, 30] })
  }, [map, key]) // eslint-disable-line react-hooks/exhaustive-deps -- refit on the lines' content, not their identity
  return null
}

const arrowIcons = new Map<string, L.DivIcon>()
const arrow = (color: string, deg: number) => {
  const k = `${color}${Math.round(deg / 5) * 5}`
  if (!arrowIcons.has(k)) arrowIcons.set(k, L.divIcon({
    className: '', iconSize: [10, 10], iconAnchor: [5, 5],
    html: `<svg width="10" height="10" viewBox="0 0 10 10" style="transform:rotate(${Math.round(deg / 5) * 5}deg);opacity:.75"><path d="M2 1.5 L7.5 5 L2 8.5" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  }))
  return arrowIcons.get(k)!
}

// Small arrows along each line when zoomed in close, so the two legs of an
// out-and-back read as going opposite ways. Only those in view are drawn.
function Arrows({ lines }: { lines: { pts: LL[]; color: string }[] }) {
  const map = useMap()
  const [view, setView] = useState(0)
  useMapEvents({ zoomend: () => setView(v => v + 1), moveend: () => setView(v => v + 1) })
  if (map.getZoom() < MARKS_MIN_ZOOM) return null
  const bounds = map.getBounds().pad(0.1)
  return lines.flatMap(({ pts, color }, li) => {
    const inView = pts.filter(p => bounds.contains(p)).length
    if (!inView) return []
    return directionMarks(pts.map(p => map.latLngToLayerPoint(p)), 70)
      .map(m => ({ ...m, ll: map.layerPointToLatLng([m.x, m.y]) }))
      .filter(m => bounds.contains(m.ll))
      .slice(0, 300)
      .map((m, i) => <Marker key={`${view}-${li}-${i}`} position={m.ll} icon={arrow(color, m.deg)} interactive={false} keyboard={false} />)
  })
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
      <Fit lines={[a, b]} />
      <Clicks onPick={onPick} />
      <Polyline positions={a} pathOptions={{ color: A_LINE, weight: 3, opacity: 0.9 }} />
      <Polyline positions={b} pathOptions={{ color: B_LINE, weight: 3, opacity: 0.9, dashArray: '6 4' }} />
      <Arrows lines={[{ pts: a, color: A_LINE }, { pts: b, color: B_LINE }]} />
      {highlight && highlight.length > 1 && <Polyline positions={highlight} pathOptions={{ color: '#facc15', weight: 9, opacity: 0.35 }} />}
      {gates?.map((g, i) => <Polyline key={i} positions={g} pathOptions={{ color: i === 0 ? '#22c55e' : '#ef4444', weight: 4 }} />)}
      {picks?.map((p, i) => <CircleMarker key={i} center={p} radius={6} pathOptions={{ color: '#facc15', fillOpacity: 1 }} />)}
      {boatA && <CircleMarker center={boatA} radius={7} pathOptions={{ color: '#0b1220', fillColor: A_LINE, fillOpacity: 1, weight: 2 }} />}
      {boatB && <CircleMarker center={boatB} radius={7} pathOptions={{ color: '#0b1220', fillColor: B_LINE, fillOpacity: 1, weight: 2 }} />}
    </MapContainer>
  )
}
