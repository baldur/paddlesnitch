// Pure data for the share-card OG image (docs/features/share-image-strava.md).
// Kept free of `next/og` + `qrcode` so it's unit-testable without rendering: it
// distils an AnalysisSession into formatted stat strings + a route polyline
// already projected into the card's viewbox. The opengraph-image route composes
// these with the QR + wordmark.
import type { AnalysisSession } from './analysis-store'
import { split500 } from './analysis'
import { BOAT_CLASS_INFO, isBoatClass } from '@paddlesnitch/core/types'
// projectRoute now lives in the shared timing package (both apps' route
// thumbnails use it); re-exported here so existing importers/tests are unchanged.
import { projectRoute } from '@paddlesnitch/timing/geo'
export { projectRoute }

export type ShareCard = {
  distance: string          // "12.4 km"
  duration: string          // "58:20" / "1:20:05"
  pace: string              // "2:21 /500" or "—"
  spm: string | null        // "84 spm"
  date: string              // "10 Aug 2026"
  tag: string | null        // boat class ("K1") when set
  pts: [number, number][]   // route polyline, projected into [viewW × viewH]
  viewW: number
  viewH: number
}

// Compact clock: m:ss, or h:mm:ss past an hour.
function fmtClock(totalS: number): string {
  const s = Math.round(totalS)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const CARD_W = 640
const CARD_H = 360
const MAX_PTS = 220

export function shareCard(session: AnalysisSession, viewW = CARD_W, viewH = CARD_H): ShareCard {
  const r = session.result
  // Downsample the (already ≤900) map points so the polyline stays light.
  const step = Math.max(1, Math.ceil(r.points.length / MAX_PTS))
  const pts = projectRoute(r.points.filter((_, i) => i % step === 0), viewW, viewH, 24)
  const tag = isBoatClass(session.boatClass) ? session.boatClass : null
  return {
    distance: `${r.distanceKm.toFixed(1)} km`,
    duration: fmtClock(r.durationS),
    pace: r.cruiseSpeed > 0.2 ? `${split500(r.cruiseSpeed)} /500` : '—',
    spm: r.avgSR != null ? `${Math.round(r.avgSR)} spm` : null,
    date: fmtDate(session.paddledAt),
    tag,
    pts,
    viewW,
    viewH,
  }
}
