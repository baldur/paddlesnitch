'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polyline, Tooltip, useMap } from 'react-leaflet'
import { useEffect } from 'react'

type LL = [number, number]
// Esri Dark Gray Canvas — keyless raster. (CARTO's free basemaps now serve an
// "API key required" nag tile once over their informal limit.) Native tiles cap
// at z16; maxNativeZoom on the layer upscales beyond so it still zooms to 19.
const DARK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ATTR = 'Tiles &copy; Esri'

function Fit({ pts }: { pts: LL[] }) {
  const map = useMap()
  useEffect(() => {
    if (!pts.length) return
    const lat = pts.map(p => p[0]), lng = pts.map(p => p[1])
    map.fitBounds([[Math.min(...lat), Math.min(...lng)], [Math.max(...lat), Math.max(...lng)]], { padding: [50, 50] })
  }, [map, pts])
  return null
}

// Overlays each racer's start→finish path over the shared stretch, plus the two
// gate lines. Colours are assigned by the caller (matching the race board).
export default function SectionRaceMap({ racers, startLine, finishLine }: {
  racers: { trackSegment: LL[]; color: string; label: string }[]
  startLine: LL[]
  finishLine: LL[]
}) {
  const all = racers.flatMap(r => r.trackSegment)
  return (
    <MapContainer center={all[0] ?? [51.5, -1]} zoom={14} style={{ height: '100%', width: '100%', background: '#0b1220' }} zoomControl>
      <TileLayer url={DARK} attribution={ATTR} maxNativeZoom={16} maxZoom={19} />
      <Fit pts={all} />
      {racers.map((r, i) => (
        <Polyline key={i} positions={r.trackSegment} pathOptions={{ color: r.color, weight: 4, opacity: 0.85 }}>
          <Tooltip sticky>{r.label}</Tooltip>
        </Polyline>
      ))}
      <Polyline positions={startLine} pathOptions={{ color: '#22c55e', weight: 4, opacity: 0.9 }} />
      <Polyline positions={finishLine} pathOptions={{ color: '#ef4444', weight: 4, opacity: 0.9 }} />
    </MapContainer>
  )
}
