'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import { useEffect, useState } from 'react'
import L from 'leaflet'
import type { CourseMetadata, LatLng, Line } from '@/lib/types'
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

function allCoursePoints(course: CourseMetadata): LatLng[] {
  if (course.gates && course.gates.length > 0) {
    return course.gates.flatMap(g => g.line)
  }
  return [...course.startLine, ...(course.finishLine ?? [])]
}

function FitBounds({ course, track }: { course: CourseMetadata; track?: LatLng[] }) {
  const map = useMap()
  useEffect(() => {
    const all: LatLng[] = [...allCoursePoints(course), ...(track ?? [])]
    const lats = all.map(p => p[0])
    const lngs = all.map(p => p[1])
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [60, 60] }
    )
  }, [map, course, track])
  return null
}

function gateColor(index: number, total: number): string {
  if (index === 0) return '#15803d'
  if (index === total - 1) return '#b91c1c'
  return '#d97706'
}

// Arrow from gate midpoint pointing toward the active crossing side
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

export default function CourseMap({ course, track, highlightGateIndex }: { course: CourseMetadata; track?: LatLng[]; highlightGateIndex?: number }) {
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted)
    return <div style={{ height: 300 }} className="bg-surface border border-border" />

  const center = course.gates ? course.gates[0].line[0] : course.startLine[0]
  const isMultiGate = course.type === 'gate' && course.gates && course.gates.length >= 2
  const isLoop = !isMultiGate && !course.finishLine

  return (
    <div className="relative">
      <button
        onClick={() => setDark(d => !d)}
        className="absolute top-2 right-2 z-[1001] px-2 py-1 text-[10px] border bg-bg border-border text-muted hover:border-primary hover:text-primary transition-colors"
        title="Toggle map style"
      >
        {dark ? 'LIGHT MAP' : 'DARK MAP'}
      </button>
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: 300, width: '100%' }}
        zoomControl={true}
      >
        <TileLayer url={TILES[dark ? 'dark' : 'light']} attribution={ATTRIBUTION} maxZoom={19} />
        <RiverLayer dark={dark} />
        <FitBounds course={course} track={track} />
        {track && track.length > 1 && (
          <Polyline
            positions={track}
            pathOptions={{ color: '#0369a1', weight: 2, opacity: 0.7 }}
          />
        )}

        {isMultiGate ? (
          // Multi-gate: render each gate with its color and direction dots
          course.gates!.map((gate, i) => {
            // A blocking gate (from a failed-upload diagnosis) is drawn in red,
            // solid and thicker, so the user can see exactly which gate to fix.
            const highlighted = i === highlightGateIndex
            const color = highlighted ? '#b91c1c' : gateColor(i, course.gates!.length)
            const weight = highlighted ? 6 : 4
            return (
              <span key={i}>
                <Polyline positions={gate.line} pathOptions={{ color, weight, dashArray: highlighted ? undefined : '8 4' }} />
                <CircleMarker center={gate.line[0]} radius={highlighted ? 7 : 5}
                  pathOptions={{ color, fillColor: color, fillOpacity: 1 }}
                />
                <CircleMarker center={gate.line[1]} radius={highlighted ? 7 : 5}
                  pathOptions={{ color, fillColor: color, fillOpacity: 1 }}
                />
                <DirectionArrow line={gate.line} direction={gate.direction} color={color} />
              </span>
            )
          })
        ) : isLoop ? (
          // Loop: one dashed violet line for crossing
          <>
            <Polyline
              positions={course.startLine}
              pathOptions={{ color: '#7c3aed', weight: 4, dashArray: '8 4' }}
            />
            <CircleMarker center={course.startLine[0]} radius={5}
              pathOptions={{ color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 1 }}
            />
            <CircleMarker center={course.startLine[1]} radius={5}
              pathOptions={{ color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 1 }}
            />
          </>
        ) : (
          // Point-to-point: green start, red finish
          <>
            <Polyline positions={course.startLine} pathOptions={{ color: '#15803d', weight: 4 }} />
            <CircleMarker center={course.startLine[0]} radius={5}
              pathOptions={{ color: '#15803d', fillColor: '#15803d', fillOpacity: 1 }}
            />
            <CircleMarker center={course.startLine[1]} radius={5}
              pathOptions={{ color: '#15803d', fillColor: '#15803d', fillOpacity: 1 }}
            />
            <Polyline positions={course.finishLine!} pathOptions={{ color: '#b91c1c', weight: 4 }} />
            <CircleMarker center={course.finishLine![0]} radius={5}
              pathOptions={{ color: '#b91c1c', fillColor: '#b91c1c', fillOpacity: 1 }}
            />
            <CircleMarker center={course.finishLine![1]} radius={5}
              pathOptions={{ color: '#b91c1c', fillColor: '#b91c1c', fillOpacity: 1 }}
            />
          </>
        )}
      </MapContainer>
    </div>
  )
}
