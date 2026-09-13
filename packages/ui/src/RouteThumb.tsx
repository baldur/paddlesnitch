'use client'
import { projectRoute } from '@paddlesnitch/timing/geo'

// A tiny, tile-less map of a paddle's route: an SVG polyline of the track shape
// (north up) with a green start dot. Cheap enough to render many per page — it
// reuses the shared route projection and draws no Leaflet map (that's for the
// detail view). Shared by the Analyse library/dashboard and the platform home.
export default function RouteThumb({ route, size = 64 }: { route?: [number, number][]; size?: number }) {
  const pts = route && route.length >= 2
    ? projectRoute(route.map(([lat, lng]) => ({ lat, lng })), size, size, 7)
    : []
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 rounded bg-[#0b1220] border border-[#1e293b]"
      role="img" aria-label="paddle route"
    >
      {pts.length >= 2 ? (
        <>
          <polyline
            points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none" stroke="#0369a1" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round"
          />
          <circle cx={pts[0][0]} cy={pts[0][1]} r={2.6} fill="#22c55e" />
        </>
      ) : (
        // No track (e.g. a fix-less session) — a neutral placeholder, not blank.
        <text x={size / 2} y={size / 2 + 3} textAnchor="middle" fontSize="9" fill="#475569">no map</text>
      )}
    </svg>
  )
}
