'use client'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, TileLayer, WMSTileLayer, Pane, Polyline, CircleMarker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AREA_MIN_ZOOM, areasIn } from '@paddlesnitch/waterways/display'
import { PORTAGE_MIN_ZOOM, type PortageMarkState, type PortagePoint } from '@paddlesnitch/waterways/portage-page'
import type { LatLng } from '@paddlesnitch/waterways/types'
import { portagePageHref, COVERAGE_LEVELS, FLANDERS_PHOTOS, GERMAN_PHOTOS, germanPhotosNear, inAustria, inFrance, inNetherlands, inSwitzerland, mapTiles, nearFlanders, type GermanPhotoId } from '@/lib/plan-ui'

// The planner's map: the rivers and canals of the UK, Ireland, the Netherlands, Belgium, France, Germany, Austria, Switzerland, Denmark and Sweden, the planned
// route, its ends and its stops. A click is passed up; the page decides whether
// it's the start or the finish.

/** The UK, Ireland, the Netherlands, Belgium, France, Germany, Austria, Switzerland, Denmark and Sweden, for a first look with nothing planned. */
const HOME: [[number, number], [number, number]] = [[42.3, -10.6], [69.1, 24.2]]

// Network pieces already fetched, shared across map instances; keyed by URL.
const loaded = new Map<string, Promise<unknown>>()
const fetchLines = <T = LatLng[][],>(url: string) => {
  let p = loaded.get(url) as Promise<T> | undefined
  if (!p) {
    p = fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    p.catch(() => loaded.delete(url))   // let a later pan retry
    loaded.set(url, p)
  }
  return p
}

/** The overview's chunk URLs (one request for the count, cached per version);
 *  the whole overview if that fails. */
const overviewUrls = new Map<string, Promise<string[]>>()
const overviewChunkUrls = (version: string) => {
  let p = overviewUrls.get(version)
  if (!p) {
    p = fetch(`/plan/data/${version}/overview-chunks`).then(r => (r.ok ? r.json() as Promise<{ chunks: number }> : Promise.reject()))
      .then(({ chunks }) => Array.from({ length: chunks }, (_, i) => `/plan/data/${version}/overview-${i}`), () => [`/plan/data/${version}/overview`])
    overviewUrls.set(version, p)
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
      ? overviewChunkUrls(version)
      : Promise.resolve(areasIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).map(k => `/plan/data/${version}/area-${k}`))
    urls.then(us => Promise.allSettled(us.map(fetchLines))).then(rs => {
      if (n === latest.current) setLines(rs.flatMap(r => (r.status === 'fulfilled' ? r.value : [])))
    })
  }, [map, version])
  useMapEvents({ moveend: refresh })
  useEffect(() => { refresh() }, [refresh])
  return <Polyline positions={lines} interactive={false} pathOptions={{ color: '#06b6d4', weight: 2, opacity: 0.55 }} />
}

const PORTAGE_COLOUR = '#f59e0b'   // the Portages stop colour
/** A tap this close to a marker is on it: about a fingertip. */
const TAP_TOLERANCE_PX = 17

const CARD_WORDS: Record<PortageMarkState, string> = { landings: 'Landings described', no_carry: 'Usually no carry', unknown: 'No landing details yet' }

function PortageCard({ id, name, state, back }: { id: string; name: string; state: PortageMarkState; back?: string }) {
  return (
    <Popup className="portage-card">
      <strong className="block text-fg">{name}</strong>
      <span className="block text-muted">{CARD_WORDS[state]}</span>
      <a className="inline-flex items-center min-h-11 text-primary-text underline" href={portagePageHref(id, back)}>Portage details</a>
    </Popup>
  )
}

/** Every portage in view once zoomed in: filled where we know the landings. A
 *  tap opens a small card rather than placing a route end. */
function Portages({ version, back }: { version: string; back?: string }) {
  const map = useMap()
  const [points, setPoints] = useState<PortagePoint[]>([])
  const latest = useRef(0)
  const refresh = useCallback(() => {
    const n = ++latest.current
    const b = map.getBounds()
    const urls = map.getZoom() < PORTAGE_MIN_ZOOM ? [] : areasIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).map(k => `/plan/data/${version}/portages-${k}`)
    Promise.allSettled(urls.map(u => fetchLines<PortagePoint[]>(u))).then(rs => {
      if (n === latest.current) setPoints(rs.flatMap(r => (r.status === 'fulfilled' ? r.value : [])))
    })
  }, [map, version])
  useMapEvents({ moveend: refresh })
  useEffect(() => { refresh() }, [refresh])
  return (
    <>
      {points.map(p => (
        <CircleMarker key={p.id} center={p.at} radius={5} bubblingMouseEvents={false}
          pathOptions={{ color: PORTAGE_COLOUR, fillColor: PORTAGE_COLOUR, fillOpacity: p.state === 'unknown' ? 0 : 0.9, weight: 2 }}>
          <PortageCard id={p.id} name={p.name} state={p.state} back={back} />
        </CircleMarker>
      ))}
    </>
  )
}

export type MapStop = { id: string; at: LatLng; name: string; colour: string; card?: PortageMarkState }

const nowMs = () => Date.now()

function Clicks({ onPick }: { onPick: (p: LatLng, zoom: number) => void }) {
  // A tap that closes a card isn't a tap on the water: the card closes just before the click.
  const closedAt = useRef(0)
  const map = useMapEvents({
    popupclose: () => { closedAt.current = nowMs() },
    click: e => { if (nowMs() - closedAt.current > 300) onPick([e.latlng.lat, e.latlng.lng], map.getZoom()) },
  })
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
  version, route, start, finish, stops, focus, view, satellite = false, coverage = false, marks = [], choices = [], showPortages = true, back, onPick,
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
  showPortages?: boolean                   // off while placing landings: a marker would catch the click
  back?: string                            // this plan, for a portage page's way back
  onPick: (p: LatLng, zoom: number) => void
}) {
  // Only whether the view is over the Netherlands, Flanders or France matters (which photos to use).
  const [over, setOver] = useState<'nl' | 'fr' | 'ch' | 'at' | undefined>()
  const [overVl, setOverVl] = useState(false)
  const [overDe, setOverDe] = useState<GermanPhotoId[]>([])
  const overNl = over === 'nl'
  const tiles = mapTiles(satellite, over)
  const [renderer] = useState(() => L.canvas({ tolerance: TAP_TOLERANCE_PX }))
  return (
    <MapContainer bounds={HOME} renderer={renderer} className="h-full w-full" data-testid="plan-map">
      <WatchCentre onChange={c => { setOver(inNetherlands(c) ? 'nl' : inFrance(c) ? 'fr' : inSwitzerland(c) ? 'ch' : inAustria(c) ? 'at' : undefined); setOverVl(nearFlanders(c)); setOverDe(germanPhotosNear(c).map(g => g.id)) }} />
      {/* Keyed so switching swaps the layer rather than mutating its url. */}
      <TileLayer key={tiles.base} url={tiles.base} attribution={tiles.attribution} maxNativeZoom={tiles.baseNativeZoom} maxZoom={19} />
      {satellite && !overNl && overVl && (
        <TileLayer key="flanders" url={FLANDERS_PHOTOS.url} attribution={FLANDERS_PHOTOS.attribution} maxNativeZoom={FLANDERS_PHOTOS.nativeZoom} maxZoom={19} />
      )}
      {/* German states' photos: transparent outside the state, so over Esri. Added
          last is drawn on top, so in reverse: Berlin's own over Brandenburg's. */}
      {satellite && GERMAN_PHOTOS.filter(g => overDe.includes(g.id)).reverse().map(g => (
        <WMSTileLayer key={g.id} url={g.wms} params={{ layers: g.layers, format: 'image/png', transparent: true }} attribution={g.attribution} maxZoom={19}
          tileSize={'tileSize' in g ? g.tileSize : 256} />
      ))}
      {coverage ? <Coverage version={version} /> : <Network version={version} />}
      {/* Esri's place names, above the rivers but below the markers and clicks. */}
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
        <TileLayer key={tiles.labels} url={tiles.labels} maxNativeZoom={tiles.labelsNativeZoom} maxZoom={19} />
      </Pane>
      {showPortages && <Portages version={version} back={back} />}
      {route.length > 0 && <Polyline positions={route} interactive={false} pathOptions={{ color: '#0ea5e9', weight: 5, opacity: 0.9 }} />}
      {stops.map(st => (
        <CircleMarker key={st.id} center={st.at} radius={5} bubblingMouseEvents={!st.card} pathOptions={{ color: st.colour, fillColor: st.colour, fillOpacity: 0.9, weight: 1 }}>
          <Tooltip>{st.name}</Tooltip>
          {st.card && <PortageCard id={st.id} name={st.name} state={st.card} back={back} />}
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
