#!/usr/bin/env node
// Fetch UK waterways from OpenStreetMap (Overpass API) and save to public/data/rivers.geojson.
// Run: pnpm rivers
// Only needs to be run once per machine; output is gitignored (~5-10 MB gzipped).

import fs from 'fs/promises'
import path from 'path'

const OVERPASS = 'https://overpass-api.de/api/interpreter'

// UK bounding box. Rivers + canals only — streams are visible on the dark base tile.
const QUERY = `
[out:json][timeout:300][bbox:49.8,-8.7,61.0,1.9];
(
  way["waterway"="river"];
  way["waterway"="canal"];
);
out geom qt;
`

type OverpassElement = {
  type: 'way'
  id: number
  geometry: { lat: number; lon: number }[]
  tags?: Record<string, string>
}

type OverpassResponse = { elements: OverpassElement[] }

const OUT = path.join(process.cwd(), 'public/data/rivers.geojson')

// Radial-distance simplification: drop points closer than `tol` degrees to
// the previous kept point. Fast O(n), good enough for background rendering.
// 0.001° ≈ 100 m at UK latitudes — imperceptible for a background water layer.
function simplify(coords: number[][], tol: number): number[][] {
  if (coords.length <= 2) return coords
  const sq = tol * tol
  let prev = coords[0]
  const out: number[][] = [prev]
  for (let i = 1; i < coords.length - 1; i++) {
    const dx = coords[i][0] - prev[0]
    const dy = coords[i][1] - prev[1]
    if (dx * dx + dy * dy > sq) { out.push(coords[i]); prev = coords[i] }
  }
  out.push(coords[coords.length - 1])
  return out.length >= 2 ? out : coords.slice(0, 1).concat(coords.slice(-1))
}

async function main() {
  console.log('Querying Overpass API for UK waterways…')
  console.log('This may take 1–3 minutes.\n')

  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'atts-river-downloader/1.0 (automated time trials system)',
    },
    body: new URLSearchParams({ data: QUERY }),
    signal: AbortSignal.timeout(330_000),
  })

  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${res.statusText}`)

  console.log('Download complete, converting + simplifying…')
  const data = await res.json() as OverpassResponse

  const ways = data.elements.filter(
    el => el.type === 'way' && el.geometry && el.geometry.length >= 2
  )

  const geojson = {
    type: 'FeatureCollection',
    features: ways.map(way => {
      const raw = way.geometry.map(pt => [+pt.lon.toFixed(5), +pt.lat.toFixed(5)])
      const simplified = simplify(raw, 0.001)
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: simplified },
        properties: { w: way.tags?.waterway ?? 'river' },
      }
    }).filter(f => f.geometry.coordinates.length >= 2),
  }

  const text = JSON.stringify(geojson)
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, text, 'utf8')

  const byType: Record<string, number> = {}
  for (const f of geojson.features) {
    const t = f.properties.w; byType[t] = (byType[t] ?? 0) + 1
  }

  const kb = Math.round(Buffer.byteLength(text) / 1024)
  console.log(`✅  Saved ${geojson.features.length} features (${kb} KB) → public/data/rivers.geojson`)
  console.log('   ', Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', '))
}

main().catch(err => { console.error(err); process.exit(1) })
