'use client'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

const PANE = 'riverPane'

function riverStyle(dark: boolean, feature?: { properties?: { w?: string } }) {
  const type = feature?.properties?.w ?? 'river'
  if (dark) {
    return {
      color: '#06b6d4',
      weight: type === 'river' ? 3 : 2,
      opacity: type === 'river' ? 1 : 0.85,
      fillOpacity: 0,
    }
  }
  return {
    color: '#0369a1',
    weight: type === 'river' ? 4 : 2.5,
    opacity: 1,
    fillOpacity: 0,
  }
}

export default function RiverLayer({ dark = true }: { dark?: boolean }) {
  const map = useMap()
  const layerRef = useRef<L.GeoJSON | null>(null)

  // Load GeoJSON once on mount
  useEffect(() => {
    // The overlay is opt-in: /data/rivers.geojson is gitignored (~3 MB gzipped,
    // regenerated with `pnpm rivers`) and isn't deployed, so fetching it 404s in
    // dev and 403s in prod — a console error on every map. Only fetch when the
    // asset is known present (set NEXT_PUBLIC_RIVERS=1 after generating/deploying it).
    if (process.env.NEXT_PUBLIC_RIVERS !== '1') return

    if (!map.getPane(PANE)) {
      map.createPane(PANE).style.zIndex = '350'
    }

    let cancelled = false
    fetch('/data/rivers.geojson')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layerRef.current = L.geoJSON(data as any, {
          style: f => riverStyle(dark, f as { properties?: { w?: string } }),
          pane: PANE,
          interactive: false,
        })
        layerRef.current.addTo(map)
        layerRef.current.bringToBack()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Re-style whenever dark toggles
  useEffect(() => {
    const pane = map.getPane(PANE)
    if (pane) {
      pane.style.filter = dark
        ? 'drop-shadow(0 0 3px rgba(6,182,212,0.9)) drop-shadow(0 0 6px rgba(6,182,212,0.5))'
        : 'none'
    }
    if (layerRef.current) {
      layerRef.current.setStyle(f => riverStyle(dark, f as { properties?: { w?: string } }))
    }
  }, [map, dark])

  return null
}
