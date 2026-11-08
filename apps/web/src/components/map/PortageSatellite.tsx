'use client'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet'
import type { LatLng } from '@paddlesnitch/waterways/types'
import { mapTiles, inFrance, inNetherlands, inSwitzerland, inAustria } from '@/lib/plan-ui'

// A portage drawn at its real place on aerial imagery: the water, the lock, and
// each carry from T to P. On screen only: the page hides it in print, because
// Esri's imagery may not be printed.

export type SatelliteCarry = { takeOut: LatLng; putIn: LatLng }

export default function PortageSatellite({ lock, name, line, carries }: { lock: LatLng; name: string; line: LatLng[]; carries: SatelliteCarry[] }) {
  const over = inNetherlands(lock) ? 'nl' as const : inFrance(lock) ? 'fr' as const : inSwitzerland(lock) ? 'ch' as const : inAustria(lock) ? 'at' as const : undefined
  const tiles = mapTiles(true, over)
  const fit = [lock, ...carries.flatMap(c => [c.takeOut, c.putIn])]
  const lat = fit.map(p => p[0]), lng = fit.map(p => p[1])
  const pad = 0.0006
  return (
    <MapContainer bounds={[[Math.min(...lat) - pad, Math.min(...lng) - pad], [Math.max(...lat) + pad, Math.max(...lng) + pad]]} dragging={!L.Browser.mobile} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer url={tiles.base} attribution={tiles.attribution} maxNativeZoom={tiles.baseNativeZoom} maxZoom={19} />
      <Polyline positions={line} interactive={false} pathOptions={{ color: '#0ea5e9', weight: 3, opacity: 0.8 }} />
      <CircleMarker center={lock} radius={6} pathOptions={{ color: '#facc15', fillOpacity: 0, weight: 3 }}><Tooltip>{name}</Tooltip></CircleMarker>
      {carries.map(c => (
        <Polyline key={`${c.takeOut}`} positions={[c.takeOut, c.putIn]} interactive={false} pathOptions={{ color: '#facc15', weight: 3, dashArray: '6 6' }} />
      ))}
      {carries.flatMap(c => [['T', c.takeOut], ['P', c.putIn]] as const).map(([t, at]) => (
        <CircleMarker key={`${t}${at}`} center={at} radius={7} pathOptions={{ color: '#0b1220', fillColor: '#facc15', fillOpacity: 1, weight: 2 }}>
          <Tooltip permanent direction="top">{t}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
