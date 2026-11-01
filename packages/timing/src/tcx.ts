import type { TrackPoint } from './types'

// TCX (Garmin Training Center XML — exported by Garmin Connect and many
// coaching tools). Parses each <Trackpoint>'s <Time> + <Position>. Stroke rate
// (cadence) is captured for paddlers (#143): TCX carries it as a direct
// <Cadence> (bike-style) or an extension <RunCadence>/<ns3:Cadence>. Heart rate
// is intentionally NOT captured. Regex-based, matching gpx.ts — no XML lib.
export function parseTcx(xml: string): TrackPoint[] {
  const points: TrackPoint[] = []
  const tpRe = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g
  const timeRe = /<Time>([^<]+)<\/Time>/
  const latRe = /<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/
  const lngRe = /<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/
  // <Cadence>, <RunCadence>, <ns3:Cadence>, <ns3:RunCadence> — any prefix.
  const cadRe = /<(?:\w+:)?(?:Run)?Cadence>([\d.]+)<\/(?:\w+:)?(?:Run)?Cadence>/

  let m: RegExpExecArray | null
  while ((m = tpRe.exec(xml)) !== null) {
    const inner = m[1]
    const timeM = timeRe.exec(inner)
    const latM = latRe.exec(inner)
    const lngM = lngRe.exec(inner)
    // A Trackpoint without a position (e.g. a paused sample) can't be timed —
    // skip it, same as GPX points missing coordinates.
    if (!timeM || !latM || !lngM) continue
    const timestamp = new Date(timeM[1])
    if (isNaN(timestamp.getTime())) continue
    const lat = parseFloat(latM[1])
    const lng = parseFloat(lngM[1])
    if (!isFinite(lat) || !isFinite(lng)) continue

    const cadM = cadRe.exec(inner)
    const strokeRate = cadM ? parseFloat(cadM[1]) : NaN

    points.push({ lat, lng, timestamp, ...(isFinite(strokeRate) ? { strokeRate } : {}) })
  }

  return points
}
