'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Pane, Polyline, Polygon, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useEffect } from 'react'
import type { LatLng } from '@paddlesnitch/waterways/types'
import { mapTiles } from '@/lib/plan-ui'

// The planner's map: every river and canal we cover, greyed-out land beyond the
// region, the planned route, its ends and its stops. A click is passed up; the
// page decides whether it's the start or the finish.

export type MapStop = { id: string; at: LatLng; name: string; colour: string }

function Clicks({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: e => onPick([e.latlng.lat, e.latlng.lng]) })
  return null
}

// Fit the route when it changes, never on other re-renders (which would undo
// the paddler's zoom); with no route, frame the region or the asked-for view.
function Frame({ route, bbox, view }: { route: LatLng[]; bbox: [number, number, number, number]; view?: { at: LatLng; zoom: number } }) {
  const map = useMap()
  const first = route[0], last = route.at(-1)
  const key = route.length ? `${first}|${last}|${route.length}` : ''
  useEffect(() => {
    if (route.length) {
      const lat = route.map(p => p[0]), lng = route.map(p => p[1])
      map.fitBounds([[Math.min(...lat), Math.min(...lng)], [Math.max(...lat), Math.max(...lng)]], { padding: [30, 30] })
    } else if (view) {
      map.setView(view.at, view.zoom)
    } else {
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]])
    }
  }, [map, key]) // eslint-disable-line react-hooks/exhaustive-deps -- refit on the route's content, not its identity
  return null
}

export type MapFocus = { at: LatLng; zoom: number }

function Focus({ focus }: { focus: MapFocus | null }) {
  const map = useMap()
  useEffect(() => { if (focus) map.setView(focus.at, Math.max(map.getZoom(), focus.zoom)) }, [map, focus])
  return null
}

export default function PlanMap({
  network, bbox, route, start, finish, stops, focus, view, satellite = false, onPick,
}: {
  network: LatLng[][]
  bbox: [number, number, number, number]   // [south, west, north, east]
  route: LatLng[]
  start: LatLng | null
  finish: LatLng | null
  stops: MapStop[]
  focus: MapFocus | null
  view?: { at: LatLng; zoom: number }
  satellite?: boolean
  onPick: (p: LatLng) => void
}) {
  const [s, w, n, e] = bbox
  const tiles = mapTiles(satellite)
  const world: LatLng[] = [[-85, -180], [-85, 180], [85, 180], [85, -180]]
  const region: LatLng[] = [[s, w], [n, w], [n, e], [s, e]]
  return (
    <MapContainer center={[(s + n) / 2, (w + e) / 2]} zoom={9} preferCanvas className="h-full w-full" data-testid="plan-map">
      {/* Keyed so switching swaps the layer rather than mutating its url. */}
      <TileLayer key={tiles.base} url={tiles.base} attribution={tiles.attribution} maxNativeZoom={tiles.baseNativeZoom} maxZoom={19} />
      {/* Land beyond the region is darkened: we have no river data there yet. */}
      <Polygon positions={[world, region]} interactive={false} pathOptions={{ stroke: false, fillColor: '#0b1220', fillOpacity: 0.6 }} />
      <Polygon positions={region} interactive={false} pathOptions={{ color: '#94a3b8', weight: 1, dashArray: '6 6', fill: false }} />
      <Polyline positions={network} interactive={false} pathOptions={{ color: '#06b6d4', weight: 2, opacity: 0.55 }} />
      {/* Esri's place names, above the rivers but below the markers and clicks. */}
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
        <TileLayer key={tiles.labels} url={tiles.labels} maxNativeZoom={tiles.labelsNativeZoom} maxZoom={19} />
      </Pane>
      {route.length > 0 && <Polyline positions={route} interactive={false} pathOptions={{ color: '#0ea5e9', weight: 5, opacity: 0.9 }} />}
      {stops.map(st => (
        <CircleMarker key={st.id} center={st.at} radius={5} pathOptions={{ color: st.colour, fillColor: st.colour, fillOpacity: 0.9, weight: 1 }}>
          <Tooltip>{st.name}</Tooltip>
        </CircleMarker>
      ))}
      {start && <CircleMarker center={start} radius={8} pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}><Tooltip>Start</Tooltip></CircleMarker>}
      {finish && <CircleMarker center={finish} radius={8} pathOptions={{ color: '#fff', fillColor: '#f87171', fillOpacity: 1, weight: 2 }}><Tooltip>Finish</Tooltip></CircleMarker>}
      <Clicks onPick={onPick} />
      <Frame route={route} bbox={bbox} view={view} />
      <Focus focus={focus} />
    </MapContainer>
  )
}
