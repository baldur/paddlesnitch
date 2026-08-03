import { describe, it, expect } from 'vitest'
import { gateAt, pathSimilarity, findSimilar, buildRace, sectionStats, GATE_M } from './similar'
import { haversine } from '@paddlesnitch/timing/geo'
import type { AnalysisPoint } from './analysis'
import type { AnalysisSession } from './analysis-store'

// A straight eastbound line at lat 51.5, one point every ~20 m, `secsPerPt`
// seconds apart. `latOffM` shifts the whole line north (metres); `reverse`
// walks the same coordinates east→west (opposite travel direction).
function line(n = 61, secsPerPt = 5, latOffM = 0, reverse = false): AnalysisPoint[] {
  const lat0 = 51.5 + latOffM / 111320
  const lng0 = -1.0
  const dLng = 0.0003 // ≈ 20.8 m at this latitude
  const pts: AnalysisPoint[] = []
  for (let i = 0; i < n; i++) {
    const idx = reverse ? n - 1 - i : i
    pts.push({ t: i * secsPerPt, lat: lat0, lng: lng0 + idx * dLng, speed: 4, sr: null, dps: null })
  }
  return pts
}

function session(id: string, points: AnalysisPoint[], paddledAt: string): AnalysisSession {
  return {
    id, userId: 'u1', createdAt: paddledAt, paddledAt,
    source: { type: 'file' }, doubleStrokeRate: false, note: '', insight: '',
    // Only `points` is read by the matcher; the rest satisfies the type.
    result: {
      durationS: 0, distanceKm: 0, avgSpeed: 0, avgSR: null, avgDps: null, cruiseSpeed: 0,
      strokeRateDoubled: false, points, stops: [], surges: [], sets: [], insight: '',
    },
  }
}

describe('gateAt', () => {
  it('is a ~60 m line perpendicular to an eastbound heading (a N–S line)', () => {
    const pts = line()
    const g = gateAt(pts, 30)
    // ~GATE_M long
    expect(haversine(g[0], g[1])).toBeGreaterThan(GATE_M - 2)
    expect(haversine(g[0], g[1])).toBeLessThan(GATE_M + 2)
    // perpendicular to due-east travel ⇒ the two ends share longitude, differ in latitude
    expect(Math.abs(g[0][1] - g[1][1])).toBeLessThan(1e-9)
    expect(Math.abs(g[0][0] - g[1][0])).toBeGreaterThan(1e-4)
  })
})

describe('pathSimilarity', () => {
  it('is 1 for an identical path and low for one that diverges far from the reference', () => {
    const ref = line().map(p => [p.lat, p.lng] as [number, number])
    expect(pathSimilarity(ref, ref)).toBe(1)
    const far = line(61, 5, 120).map(p => [p.lat, p.lng] as [number, number]) // 120 m north
    expect(pathSimilarity(ref, far)).toBeLessThan(0.25)
  })
})

describe('findSimilar', () => {
  const src = session('src', line(), '2026-07-10T08:00:00Z')

  it('matches a same-direction paddle over the selected stretch', () => {
    const faster = session('faster', line(61, 4), '2026-07-12T08:00:00Z') // same path, quicker
    const r = findSimilar(src, [faster], 10, 50)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.map(m => m.sessionId)).toEqual(['faster'])
    expect(r.matches[0].elapsedS).toBeGreaterThan(0)
    expect(r.matches[0].sectionM).toBeGreaterThan(700) // ~40 × 20.8 m
  })

  it('excludes a paddle travelling the opposite direction', () => {
    const opposite = session('opp', line(61, 5, 0, true), '2026-07-11T08:00:00Z')
    const r = findSimilar(src, [opposite], 10, 50)
    expect(r.ok && r.matches).toEqual([])
  })

  it('excludes a paddle that never crosses the gates (different water)', () => {
    const elsewhere = session('elsewhere', line(61, 5, 200), '2026-07-11T08:00:00Z') // 200 m north
    const r = findSimilar(src, [elsewhere], 10, 50)
    expect(r.ok && r.matches).toEqual([])
  })

  it('returns matches newest-first', () => {
    const older = session('older', line(61, 6), '2026-07-05T08:00:00Z')
    const newer = session('newer', line(61, 4), '2026-07-18T08:00:00Z')
    const r = findSimilar(src, [older, newer], 10, 50)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.map(m => m.sessionId)).toEqual(['newer', 'older'])
  })

  it('rejects a section shorter than the minimum', () => {
    const r = findSimilar(src, [], 10, 14) // ~4 points ≈ 83 m
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('section_too_short')
  })
})

describe('sectionStats', () => {
  const src = session('src', line(61, 5), '2026-07-10T08:00:00Z')

  it('computes distance/elapsed/pace over the literal selected slice', () => {
    const s = sectionStats(src, 10, 50)!
    expect(s).not.toBeNull()
    expect(s.sectionM).toBeGreaterThan(700)          // ~40 × 20.8 m
    expect(s.elapsedS).toBeCloseTo((50 - 10) * 5, 0) // 40 points × 5 s
    expect(s.cruiseSpeed).toBeCloseTo(s.sectionM / s.elapsedS, 6)
    expect(s.splits.length).toBeGreaterThanOrEqual(1) // ≥1 full 500 m
  })

  it('respects click order (works when start > finish) and rejects a degenerate pick', () => {
    const forward = sectionStats(src, 10, 50)!
    const swapped = sectionStats(src, 50, 10)!
    expect(swapped.sectionM).toBeCloseTo(forward.sectionM, 6)
    expect(sectionStats(src, 10, 10)).toBeNull()
  })

  it('carries avgSR/avgDps and conditions when present', () => {
    const pts = line(61, 5).map(p => ({ ...p, sr: 60, dps: 4 / (60 / 60) }))
    const withSR: AnalysisSession = { ...src, result: { ...src.result, points: pts, conditions: { windKmh: 12, windDir: 90, flowM3s: 2.5 } } }
    const s = sectionStats(withSR, 10, 50)!
    expect(Math.round(s.avgSR!)).toBe(60)
    expect(s.avgDps!).toBeGreaterThan(0)
    expect(s.conditions?.flowM3s).toBe(2.5)
  })
})

describe('buildRace', () => {
  it('includes the source first, then the picked paddles, with elapsed times', () => {
    const src = session('src', line(61, 5), '2026-07-10T08:00:00Z')
    const other = session('other', line(61, 4), '2026-07-12T08:00:00Z')
    const race = buildRace(src, [other], 10, 50)
    expect('racers' in race).toBe(true)
    if (!('racers' in race)) return
    expect(race.racers.map(r => r.sessionId)).toEqual(['src', 'other'])
    expect(race.racers[0].isSource).toBe(true)
    // same stretch, the 4 s/pt paddle is faster than the 5 s/pt source
    expect(race.racers[1].elapsedS).toBeLessThan(race.racers[0].elapsedS)
  })
})
