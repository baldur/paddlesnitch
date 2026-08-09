import type { LatLng, Line, TrackPoint, Split, ProcessedResult, CourseType } from './types'

const EARTH_RADIUS_M = 6371000

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

// Midpoint of a line's two endpoints. Used as a course's representative
// location (weather + nearest flow station) — see #106.
export function lineMidpoint(line: Line): LatLng {
  return [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2]
}

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const sinHalfLat = Math.sin(dLat / 2)
  const sinHalfLng = Math.sin(dLng / 2)
  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinHalfLng * sinHalfLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

// Returns { t, rxs } where t ∈ [0,1] along segment a→b where it intersects segment c→d.
// rxs is the cross product (used to determine crossing direction/sign).
// Returns null if no intersection.
// Uses parametric form + 2D cross product. Degrees treated as flat coords (valid for short segments).
function segmentIntersect(
  a: LatLng, b: LatLng, c: LatLng, d: LatLng
): { t: number; rxs: number } | null {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = d[0] - c[0]
  const sy = d[1] - c[1]
  const rxs = rx * sy - ry * sx
  if (Math.abs(rxs) < 1e-12) return null // parallel or collinear
  const qpx = c[0] - a[0]
  const qpy = c[1] - a[1]
  const t = (qpx * sy - qpy * sx) / rxs
  const u = (qpx * ry - qpy * rx) / rxs
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { t, rxs }
  return null
}

type Crossing = {
  timestamp: Date
  trackIndex: number // index of track[i] where crossing occurs between i and i+1
  t: number         // interpolation parameter along that segment
  rxsSign: number   // sign of the cross product (+1 or -1)
}

function makeCrossing(track: TrackPoint[], i: number, t: number, rxs: number): Crossing {
  const ms0 = track[i].timestamp.getTime()
  const ms1 = track[i + 1].timestamp.getTime()
  return { timestamp: new Date(ms0 + t * (ms1 - ms0)), trackIndex: i, t, rxsSign: Math.sign(rxs) }
}

// All crossings of `line` in `track` from `startFromIndex`, optionally filtered by direction sign.
function findAllCrossings(
  track: TrackPoint[],
  line: Line,
  startFromIndex = 0,
  requiredSign?: number
): Crossing[] {
  const results: Crossing[] = []
  for (let i = startFromIndex; i < track.length - 1; i++) {
    const a: LatLng = [track[i].lat, track[i].lng]
    const b: LatLng = [track[i + 1].lat, track[i + 1].lng]
    const intersect = segmentIntersect(a, b, line[0], line[1])
    if (intersect !== null) {
      const { t, rxs } = intersect
      if (requiredSign !== undefined && Math.sign(rxs) !== requiredSign) continue
      results.push(makeCrossing(track, i, t, rxs))
    }
  }
  return results
}

// First crossing of `line` from `startFromIndex`, optionally filtered by direction sign.
function findFirstCrossing(
  track: TrackPoint[],
  line: Line,
  startFromIndex = 0,
  requiredSign?: number
): Crossing | null {
  for (let i = startFromIndex; i < track.length - 1; i++) {
    const a: LatLng = [track[i].lat, track[i].lng]
    const b: LatLng = [track[i + 1].lat, track[i + 1].lng]
    const intersect = segmentIntersect(a, b, line[0], line[1])
    if (intersect !== null) {
      const { t, rxs } = intersect
      if (requiredSign !== undefined && Math.sign(rxs) !== requiredSign) continue
      return makeCrossing(track, i, t, rxs)
    }
  }
  return null
}

function calculateSplits(
  track: TrackPoint[],
  startCrossing: Crossing,
  finishCrossing: Crossing,
  splitDistanceM = 500
): Split[] {
  const startMs = startCrossing.timestamp.getTime()
  const splits: Split[] = []
  let accumulated = 0
  let nextBoundary = splitDistanceM
  let prev: LatLng = [
    track[startCrossing.trackIndex].lat + startCrossing.t * (track[startCrossing.trackIndex + 1].lat - track[startCrossing.trackIndex].lat),
    track[startCrossing.trackIndex].lng + startCrossing.t * (track[startCrossing.trackIndex + 1].lng - track[startCrossing.trackIndex].lng),
  ]
  let prevMs =
    track[startCrossing.trackIndex].timestamp.getTime() +
    startCrossing.t *
      (track[startCrossing.trackIndex + 1].timestamp.getTime() - track[startCrossing.trackIndex].timestamp.getTime())

  for (let i = startCrossing.trackIndex + 1; i <= finishCrossing.trackIndex + 1; i++) {
    if (i >= track.length) break
    const curr: LatLng = [track[i].lat, track[i].lng]
    const currMs = track[i].timestamp.getTime()
    const segDist = haversine(prev, curr)

    while (accumulated + segDist >= nextBoundary) {
      const fraction = (nextBoundary - accumulated) / segDist
      const boundaryMs = prevMs + fraction * (currMs - prevMs)
      splits.push({
        distance: nextBoundary,
        elapsedSeconds: (boundaryMs - startMs) / 1000,
      })
      nextBoundary += splitDistanceM
    }

    accumulated += segDist
    prev = curr
    prevMs = currMs

    if (i === finishCrossing.trackIndex + 1) break
  }

  return splits
}

function buildResult(
  track: TrackPoint[],
  startCrossing: Crossing,
  finishCrossing: Crossing
): ProcessedResult | null {
  const startMs = startCrossing.timestamp.getTime()
  const finishMs = finishCrossing.timestamp.getTime()
  if (finishMs <= startMs) return null

  const splits = calculateSplits(track, startCrossing, finishCrossing)
  const segment = track.slice(startCrossing.trackIndex, finishCrossing.trackIndex + 2)

  const startPt: LatLng = [
    track[startCrossing.trackIndex].lat + startCrossing.t * (track[startCrossing.trackIndex + 1].lat - track[startCrossing.trackIndex].lat),
    track[startCrossing.trackIndex].lng + startCrossing.t * (track[startCrossing.trackIndex + 1].lng - track[startCrossing.trackIndex].lng),
  ]
  const finishPt: LatLng = [
    track[finishCrossing.trackIndex].lat + finishCrossing.t * (track[finishCrossing.trackIndex + 1].lat - track[finishCrossing.trackIndex].lat),
    track[finishCrossing.trackIndex].lng + finishCrossing.t * (track[finishCrossing.trackIndex + 1].lng - track[finishCrossing.trackIndex].lng),
  ]
  const midPoints = segment.map((p): LatLng => [p.lat, p.lng])
  // Round lat/lng to 6dp (~0.1 m, well under GPS noise) before it's stored and
  // sent to the map. Full-precision floats are ~incompressible and dominate the
  // payload; this cuts the served trackSegment ~2.8× after gzip.
  const round6 = ([lat, lng]: LatLng): LatLng => [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]
  const trackSegment: LatLng[] = [startPt, ...midPoints, finishPt].map(round6)

  // Average stroke rate over the racing window, from whichever points carried
  // it (#143). Bound strictly to [startMs, finishMs] by timestamp — `segment`
  // includes the bracketing points just outside the crossings (needed for the
  // geometry), which would skew the average with warmup/cooldown strokes. Mean
  // of defined values, one decimal; undefined when no source stroke-rate data.
  const rates = track
    .filter(p => p.strokeRate != null && p.timestamp.getTime() >= startMs && p.timestamp.getTime() <= finishMs)
    .map(p => p.strokeRate as number)
  const avgStrokeRate = rates.length
    ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10
    : undefined

  return {
    startTimestamp: startCrossing.timestamp.toISOString(),
    finishTimestamp: finishCrossing.timestamp.toISOString(),
    totalElapsedSeconds: (finishMs - startMs) / 1000,
    splits,
    trackSegment,
    ...(avgStrokeRate != null ? { avgStrokeRate } : {}),
  }
}

// Multi-gate: athlete must cross each gate in the defined direction in sequence.
// Tries every valid start crossing and returns the fastest complete run.
function processMultiGate(
  track: TrackPoint[],
  gates: Array<{ line: Line; direction: 1 | -1 }>,
  minValidSeconds: number
): ProcessedResult | null {
  if (track.length < 2 || gates.length < 2) return null

  const startCrossings = findAllCrossings(track, gates[0].line)
    .filter(c => c.rxsSign === gates[0].direction)
  if (startCrossings.length === 0) return null

  let best: ProcessedResult | null = null
  let runCount = 0

  for (const startCrossing of startCrossings) {
    let current: Crossing = startCrossing
    let valid = true

    for (let g = 1; g < gates.length; g++) {
      const next = findFirstCrossing(track, gates[g].line, current.trackIndex + 1, gates[g].direction)
      if (!next) { valid = false; break }
      current = next
    }

    if (!valid) continue
    const candidate = buildResult(track, startCrossing, current)
    if (!candidate || candidate.totalElapsedSeconds < minValidSeconds) continue
    runCount++
    if (!best || candidate.totalElapsedSeconds < best.totalElapsedSeconds) best = candidate
  }

  if (best) best.runCount = runCount
  return best
}

export type GateDiagnosis = {
  total: number
  // Gates satisfied (in order, in the required direction) before the block.
  gatesPassed: number
  blocking: {
    gateNumber: number          // 1-based, for display
    requiredDirection: 1 | -1
    // wrong_direction: the gate WAS crossed after the previous one, but only in
    // the opposite direction (likely a backwards gate config, or the athlete
    // passed it the wrong way). not_crossed: no crossing after the previous gate
    // at all (GPS gap, skipped, or out of order).
    reason: 'wrong_direction' | 'not_crossed'
  } | null                       // null only if the chain actually completes
}

// Explain why a multi-gate match failed: how far the run got, and what blocked
// the next gate. Only called on the failure path (a successful match returns a
// result and never reaches here), so the extra scan cost doesn't matter.
export function diagnoseGates(
  track: TrackPoint[],
  gates: Array<{ line: Line; direction: 1 | -1 }>,
): GateDiagnosis {
  const total = gates.length

  // Start gate must be crossed in its required direction to begin the chain.
  const startCandidates = findAllCrossings(track, gates[0].line)
    .filter(c => c.rxsSign === gates[0].direction)
  if (startCandidates.length === 0) {
    const crossedWrongWay = findAllCrossings(track, gates[0].line).length > 0
    return {
      total,
      gatesPassed: 0,
      blocking: {
        gateNumber: 1,
        requiredDirection: gates[0].direction,
        reason: crossedWrongWay ? 'wrong_direction' : 'not_crossed',
      },
    }
  }

  // Try every valid start crossing; keep the chain that reaches the furthest
  // gate, so we report the most progress the athlete actually made.
  let bestPassed = 0
  let bestBlockIndex = 1
  let bestBlockFromIndex = startCandidates[0].trackIndex

  for (const start of startCandidates) {
    let current = start
    let passed = 1
    let g = 1
    for (; g < total; g++) {
      const next = findFirstCrossing(track, gates[g].line, current.trackIndex + 1, gates[g].direction)
      if (!next) break
      current = next
      passed++
    }
    if (passed === total) return { total, gatesPassed: total, blocking: null }
    if (passed > bestPassed) {
      bestPassed = passed
      bestBlockIndex = g
      bestBlockFromIndex = current.trackIndex
    }
  }

  // Reason for the furthest chain's block: was the blocking gate crossed at all
  // (any direction) after the last satisfied gate? Yes → wrong direction; no →
  // never crossed.
  const blockGate = gates[bestBlockIndex]
  const crossedWrongWay = findFirstCrossing(track, blockGate.line, bestBlockFromIndex + 1) !== null
  return {
    total,
    gatesPassed: bestPassed,
    blocking: {
      gateNumber: bestBlockIndex + 1,
      requiredDirection: blockGate.direction,
      reason: crossedWrongWay ? 'wrong_direction' : 'not_crossed',
    },
  }
}

// Human-readable explanation of a gate diagnosis. Shared by the upload route
// (athlete-facing failure) and the reference-trace validator (organiser-facing).
export function gateDiagnosisMessage(d: GateDiagnosis): string {
  if (!d.blocking) return 'The trace crosses every gate in the required order and direction.'
  const { gateNumber, reason } = d.blocking
  const progress = d.gatesPassed > 0 ? `You passed ${d.gatesPassed} of ${d.total} gates in order. ` : ''
  if (reason === 'wrong_direction') {
    return `${progress}Gate ${gateNumber} was crossed in the opposite direction to what the course requires. Either you passed it the wrong way, or gate ${gateNumber}'s direction is set incorrectly on the course.`
  }
  const where = d.gatesPassed > 0 ? ' after the previous gate' : ''
  return `${progress}Gate ${gateNumber} was not crossed${where}. Make sure your GPS was recording as you passed through every gate, in the right order and direction.`
}

// Try every start-line crossing and pair it with the correct finish crossing for the course type.
// Return the fastest valid pair — equivalent to Strava's "best effort on segment" behaviour.
export function processTrace(
  track: TrackPoint[],
  startLine: Line,
  finishLine: Line | undefined,
  courseType: CourseType = 'point_to_point',
  minValidSeconds = 0,
  gateDirection?: 1 | -1,
  gates?: Array<{ line: Line; direction: 1 | -1 }>,
  // Internal: set false on the swapped retry below so the fallback runs at most
  // once (prevents infinite recursion). Callers leave it at the default.
  tryReverse = true
): ProcessedResult | null {
  if (track.length < 2) return null

  // Multi-gate: delegate to dedicated processor
  if (courseType === 'gate' && gates && gates.length >= 2) {
    return processMultiGate(track, gates, minValidSeconds)
  }

  const allStartCrossings = findAllCrossings(track, startLine)
  if (allStartCrossings.length === 0) return null

  // gate: only crossings in the defined direction can start the clock
  const startCrossings = (courseType === 'gate' && gateDirection != null)
    ? allStartCrossings.filter(c => c.rxsSign === gateDirection)
    : allStartCrossings

  if (startCrossings.length === 0) return null

  let best: ProcessedResult | null = null
  let runCount = 0

  for (const startCrossing of startCrossings) {
    let finishCrossing: Crossing | null = null

    if (courseType === 'point_to_point' || courseType === 'one_way') {
      if (!finishLine) continue
      finishCrossing = findFirstCrossing(track, finishLine, startCrossing.trackIndex + 1)
    } else if (courseType === 'loop') {
      // any next crossing regardless of direction
      finishCrossing = findFirstCrossing(track, startLine, startCrossing.trackIndex + 1)
    } else if (courseType === 'gate') {
      // if a finish line is provided, use it; otherwise expect opposite-direction re-crossing
      if (finishLine) {
        finishCrossing = findFirstCrossing(track, finishLine, startCrossing.trackIndex + 1)
      } else {
        finishCrossing = findFirstCrossing(track, startLine, startCrossing.trackIndex + 1, -startCrossing.rxsSign)
      }
    } else if (courseType === 'out_and_back') {
      finishCrossing = findFirstCrossing(track, startLine, startCrossing.trackIndex + 1, -startCrossing.rxsSign)
    } else if (courseType === 'lap') {
      finishCrossing = findFirstCrossing(track, startLine, startCrossing.trackIndex + 1, startCrossing.rxsSign)
    } else if (courseType === 'figure_eight') {
      const mid = findFirstCrossing(track, startLine, startCrossing.trackIndex + 1, -startCrossing.rxsSign)
      if (!mid) continue
      finishCrossing = findFirstCrossing(track, startLine, mid.trackIndex + 1, startCrossing.rxsSign)
    }

    if (!finishCrossing) continue

    const candidate = buildResult(track, startCrossing, finishCrossing)
    if (!candidate) continue
    if (candidate.totalElapsedSeconds < minValidSeconds) continue

    runCount++
    if (!best || candidate.totalElapsedSeconds < best.totalElapsedSeconds) {
      best = candidate
    }
  }

  if (best) best.runCount = runCount

  // Fallback for point-to-point: a run that crossed the finish line first and
  // never re-crossed it after the start has no forward start→finish segment, so
  // `best` is null. Before yielding an error, try once more with the two lines'
  // roles swapped — i.e. allow the clock to run finish→start (the athlete went
  // the course's other direction, or the lines were drawn the opposite way).
  // Forward is preferred: this only fires when the normal pass found nothing, so
  // a properly-directed run is never affected. See issue #66.
  if (!best && tryReverse && (courseType === 'point_to_point' || courseType === 'one_way') && finishLine) {
    return processTrace(track, finishLine, startLine, courseType, minValidSeconds, gateDirection, gates, false)
  }

  return best
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}
