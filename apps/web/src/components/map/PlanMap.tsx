'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Pane, Polyline, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AREA_MIN_ZOOM, areasIn } from '@paddlesnitch/waterways/display'
import type { LatLng } from '@paddlesnitch/waterways/types'
import { COVERAGE_LEVELS, FLANDERS_PHOTOS, inFrance, inNetherlands, mapTiles, nearFlanders } from '@/lib/plan-ui'

// The planner's map: the rivers and canals of the UK, Ireland, the Netherlands, Belgium, France and Germany, the planned
// route, its ends and its stops. A click is passed up; the page decides whether
// it's the start or the finish.

/** The UK, Ireland, the Netherlands, Belgium, France and Germany, for a first look with nothing planned. */
const HOME: [[number, number], [number, number]] = [[42.3, -10.6], [60.9, 15.1]]

// Network pieces already fetched, shared across map instances; keyed by URL.
const loaded = new Map<string, Promise<LatLng[][]>>()
const fetchLines = (url: string) => {
  let p = loaded.get(url)
  if (!p) {
    p = fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    p.catch(() => loaded.delete(url))   // let a later pan retry
    loaded.set(url, p)
  }
  return p
}

const LEVEL_COLOUR = Object.fromEntries(COVERAGE_LEVELS.map(l => [l.id, l.colour])) as Record<'good' | 'some' | 'thin', string>

/** The scored water, coloured by how well we know it (the COVERAGE switch). */
function Coverage({ version }: { version: string }) {
  const [lines, setLines] = useState<Record<'good' | 'some' | 'thin', LatLng[][]> | null>(null)
  useEffect(() => {
    // An index, then each level's chunks (in one response it's over the server's limit).
    const json = <T,>(name: string) => fetch(`/plan/data/${version}/${name}`).then(r => (r.ok ? r.json() as Promise<T> : Promise.reject()))
    const level = (l: 'good' | 'some' | 'thin', n: number) => Promise.all(Array.from({ length: n }, (_, i) => json<LatLng[][]>(`coverage-lines-${l}-${i}`))).then(cs => cs.flat())
    json<Record<'good' | 'some' | 'thin', number>>('coverage-lines')
      .then(n => Promise.all([level('good', n.good), level('some', n.some), level('thin', n.thin)]))
      .then(([good, some, thin]) => setLines({ good, some, thin }), () => setLines(null))
  }, [version])
  if (!lines) return null
  return (
    <>
      {(['thin', 'some', 'good'] as const).map(level => (
        <Polyline key={level} positions={lines[level]} interactive={false} pathOptions={{ color: LEVEL_COLOUR[level], weight: 3, opacity: 0.85 }} />
      ))}
    </>
  )
}

/** The network for what's on screen: the overview when zoomed out, the
 *  detailed areas in view when zoomed in. */
function Network({ version }: { version: string }) {
  const map = useMap()
  const [lines, setLines] = useState<LatLng[][]>([])
  const latest = useRef(0)   // a slow earlier fetch mustn't overwrite a newer view
  const refresh = useCallback(() => {
    const n = ++latest.current
    const b = map.getBounds()
    const urls = map.getZoom() < AREA_MIN_ZOOM
      ? [`/plan/data/${version}/overview`]
      : areasIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).map(k => `/plan/data/${version}/area-${k}`)
    Promise.allSettled(urls.map(fetchLines)).then(rs => {
      if (n === latest.current) setLines(rs.flatMap(r => (r.status === 'fulfilled' ? r.value : [])))
    })
  }, [map, version])
  useMapEvents({ moveend: refresh })
  useEffect(() => { refresh() }, [refresh])
  return <Polyline positions={lines} interactive={false} pathOptions={{ color: '#06b6d4', weight: 2, opacity: 0.55 }} />
}

export type MapStop = { id: string; at: LatLng; name: string; colour: string }

function Clicks({ onPick }: { onPick: (p: LatLng, zoom: number) => void }) {
  const map = useMapEvents({ click: e => onPick([e.latlng.lat, e.latlng.lng], map.getZoom()) })
  return null
}

// Fit the route when it changes, never on other re-renders (which would undo
// the paddler's zoom); with no route, the asked-for view or HOME.
function Frame({ route, view }: { route: LatLng[]; view?: { at: LatLng; zoom: number } }) {
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
      map.fitBounds(HOME)
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

function WatchCentre({ onChange }: { onChange: (c: LatLng) => void }) {
  const map = useMapEvents({ moveend: () => { const c = map.getCenter(); onChange([c.lat, c.lng]) } })
  return null
}

export default function PlanMap({
  version, route, start, finish, stops, focus, view, satellite = false, coverage = false, marks = [], choices = [], onPick,
}: {
  version: string                          // the dataset's version, for the network's URLs
  route: LatLng[]
  start: LatLng | null
  finish: LatLng | null
  stops: MapStop[]
  focus: MapFocus | null
  view?: { at: LatLng; zoom: number }
  satellite?: boolean
  coverage?: boolean                       // colour the water by how well we know it
  marks?: LatLng[]                         // landings being placed for a portage
  choices?: { at: LatLng; label: string }[] // the waterways an unclear click could have meant
  onPick: (p: LatLng, zoom: number) => void
}) {
  // Only whether the view is over the Netherlands, Flanders or France matters (which photos to use).
  const [over, setOver] = useState<'nl' | 'fr' | undefined>()
  const [overVl, setOverVl] = useState(false)
  const overNl = over === 'nl'
  const tiles = mapTiles(satellite, over)
  return (
    <MapContainer bounds={HOME} preferCanvas className="h-full w-full" data-testid="plan-map">
      <WatchCentre onChange={c => { setOver(inNetherlands(c) ? 'nl' : inFrance(c) ? 'fr' : undefined); setOverVl(nearFlanders(c)) }} />
      {/* Keyed so switching swaps the layer rather than mutating its url. */}
      <TileLayer key={tiles.base} url={tiles.base} attribution={tiles.attribution} maxNativeZoom={tiles.baseNativeZoom} maxZoom={19} />
      {satellite && !overNl && overVl && (
        <TileLayer key="flanders" url={FLANDERS_PHOTOS.url} attribution={FLANDERS_PHOTOS.attribution} maxNativeZoom={FLANDERS_PHOTOS.nativeZoom} maxZoom={19} />
      )}
      {coverage ? <Coverage version={version} /> : <Network version={version} />}
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
      {marks.length === 2 && <Polyline positions={marks} interactive={false} pathOptions={{ color: '#facc15', weight: 3, dashArray: '6 6' }} />}
      {marks.map((m, i) => (
        <CircleMarker key={i} center={m} radius={7} pathOptions={{ color: '#0b1220', fillColor: '#facc15', fillOpacity: 1, weight: 2 }}>
          <Tooltip permanent direction="top">{i === 0 ? 'Landing 1' : 'Landing 2'}</Tooltip>
        </CircleMarker>
      ))}
      {choices.map(c => (
        <CircleMarker key={`${c.at}`} center={c.at} radius={7} interactive={false} pathOptions={{ color: '#facc15', fillOpacity: 0, weight: 3 }}>
          {/* The northernmost label above its point, the others below, so they don't overlap. */}
          <Tooltip permanent direction={c.at[0] >= Math.max(...choices.map(o => o.at[0])) ? 'top' : 'bottom'}>{c.label}</Tooltip>
        </CircleMarker>
      ))}
      <Clicks onPick={onPick} />
      <Frame route={route} view={view} />
      <Focus focus={focus} />
    </MapContainer>
  )
}
