import { describe, it, expect } from 'vitest'
import { compareLines, compareSection, lineSummary, replayAt, movingClock, type LinePoint } from '@paddlesnitch/analysis/line-compare'
import type { AnalysisPoint } from '@paddlesnitch/analysis/analysis'

// A boat on a path given in metres east/north of a point on a river, paddling
// at `speed` m/s, one point a second (as saved paddles' points are).
const LAT0 = 51.46, LNG0 = -0.93
const toLL = (x: number, y: number) => ({ lat: LAT0 + y / 110_540, lng: LNG0 + x / (Math.cos(LAT0 * Math.PI / 180) * 111_320) })
function boat(path: [number, number][], speed: (atM: number) => number): LinePoint[] {
  const out: LinePoint[] = []
  let seg = 0, along = 0, t = 0
  const segLen = (i: number) => Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
  let total = 0
  while (seg < path.length - 1) {
    const L = segLen(seg), f = along / L
    const [x0, y0] = path[seg], [x1, y1] = path[seg + 1]
    out.push({ t, ...toLL(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f) })
    const step = speed(total)
    along += step; total += step; t += 1
    while (seg < path.length - 1 && along >= segLen(seg)) { along -= segLen(seg); seg++ }
  }
  return out
}
// A river running north 1 km, bending right (east) through a 90° corner, then 1 km east.
const bend = (offset = 0, cutInside = 0): [number, number][] => {
  const p: [number, number][] = [[offset, 0], [offset, 1000]]
  for (let k = 1; k <= 9; k++) {   // the corner, radius 100 m (less when cutting the inside)
    const a = (k / 10) * Math.PI / 2, r = 100 - cutInside
    p.push([offset + 100 - r * Math.cos(a), 1000 + r * Math.sin(a)])
  }
  p.push([offset + 100, 1100 - offset], [offset + 1100, 1100 - offset])
  return p
}

describe('comparing two lines on the same water', () => {
  it('same line, B faster: no gap, B ahead and gaining all the way', () => {
    const a = boat(bend(), () => 3), b = boat(bend(), () => 3.3)
    const c = compareLines(a, b)!
    expect(c.overlapShare).toBeGreaterThan(0.95)
    expect(c.toM - c.fromM).toBeGreaterThan(2000)
    expect(Math.max(...c.bins.map(x => x.gapM))).toBeLessThan(3)
    expect(c.total.bSecs).toBeLessThan(c.total.aSecs)
    expect(c.ahead[c.ahead.length - 1].secs).toBeLessThan(-50)       // B ~65 s up after ~2.1 km
    expect(lineSummary(c)[0]).toMatch(/B was \d+ s faster/)
    expect(lineSummary(c)[1]).toBe('The two lines stayed within 10 m of each other.')
  })

  it('B cuts the inside of the bend: the gap shows there, on the right, and B covers less', () => {
    const a = boat(bend(), () => 3), b = boat(bend(0, 25), () => 3)
    const c = compareLines(a, b)!
    const corner = c.bins.filter(x => x.fromM >= 1000 && x.toM <= 1157)
    expect(Math.max(...corner.map(x => x.gapM))).toBeGreaterThan(5)
    const widest = [...c.bins].sort((x, y) => y.gapM - x.gapM)[0]
    expect(widest.side).toBe(1)                      // inside of a right-hand bend: to the right
    expect(c.total.bMetres).toBeLessThan(c.total.aMetres)
    expect(c.bins.filter(x => x.toM <= 950).every(x => x.gapM < 3)).toBe(true)   // straight: together
  })

  it('out and back on the same water: B is matched leg for leg, never to the other leg', () => {
    const outBack: [number, number][] = [[0, 0], [0, 1500], [20, 1500], [20, 0]]   // back 20 m to the side
    const a = boat(outBack, () => 3), b = boat(outBack, s => (s < 1500 ? 3 : 2.5))
    const c = compareLines(a, b)!
    expect(c.toM - c.fromM).toBeGreaterThan(2900)       // the whole way out AND back
    expect(Math.max(...c.bins.map(x => x.gapM))).toBeLessThan(3)
    const half = c.ahead.find(x => x.atM >= 1500)!
    expect(Math.abs(half.secs)).toBeLessThan(3)          // level at the turn
    expect(c.ahead[c.ahead.length - 1].secs).toBeGreaterThan(80)   // B slower home
  })

  it('B started further down: the shared stretch begins where B joined, and the replay starts both there', () => {
    const a = boat(bend(), () => 3)
    const b = boat(bend(), () => 3).filter(p => (p.lat - LAT0) * 110_540 >= 300 || p.lng > LNG0 + 0.0001)
    const shifted = b.map(p => ({ ...p, t: p.t - b[0].t }))
    const c = compareLines(a, shifted)!
    expect(c.fromM).toBeGreaterThan(290)
    expect(c.fromM).toBeLessThan(310)
    const r = replayAt(a, shifted, c, 0)
    const gap = Math.hypot((r.a!.lat - r.b!.lat) * 110_540, (r.a!.lng - r.b!.lng) * 69_400)
    expect(gap).toBeLessThan(5)                          // both at the same spot at the start
  })

  it('two different rivers: nothing to compare', () => {
    const a = boat(bend(), () => 3)
    const b = boat(bend().map(([x, y]) => [x + 5000, y]), () => 3)
    expect(compareLines(a, b)).toBeNull()
  })

  it('names the paddles in the summary', () => {
    const c = compareLines(boat(bend(), () => 3), boat(bend(), () => 3.3))!
    expect(lineSummary(c, '12 Oct', '5 Oct')[0]).toMatch(/5 Oct was \d+ s faster/)
  })
})

// Real pairs taught these (two of the owner's paddles from the same club).
describe('comparing real outings fairly', () => {
  const asPoints = (pts: LinePoint[]): AnalysisPoint[] => pts.map(p => ({ ...p, speed: 3, sr: null, dps: null }))

  it('a rest is not slowness: 10 minutes standing at the start costs nothing', () => {
    const a = boat(bend(), () => 3)
    const moving = boat(bend(), () => 3)
    // B waits 600 s on the start before setting off.
    const b = [...Array.from({ length: 600 }, (_, k) => ({ ...moving[0], t: k })), ...moving.map(p => ({ ...p, t: p.t + 600 }))]
    expect(movingClock(b)[b.length - 1]).toBeLessThan(moving[moving.length - 1].t + 2)
    const c = compareLines(a, b)!
    expect(Math.abs(c.total.bSecs - c.total.aSecs)).toBeLessThan(3)
  })

  it('B leaving the route and coming back ends the pass: its time away is never counted', () => {
    const a = boat(bend(), () => 3)
    // B paddles 600 m, goes 1 km up a side channel and back, then carries on.
    const out = boat([[0, 0], [0, 600]], () => 3)
    const detour = boat([[0, 600], [800, 600], [0, 600]], () => 3).map(p => ({ ...p, t: p.t + out[out.length - 1].t + 1 }))
    const rest = boat(bend().slice(1).map(([x, y]) => [x, Math.max(y, 600)] as [number, number]), () => 3)
      .map(p => ({ ...p, t: p.t + detour[detour.length - 1].t + 1 }))
    const c = compareLines(a, [...out, ...detour, ...rest])!
    expect(c.fromM).toBeGreaterThan(550)                  // the longer pass, after the detour
    expect(Math.max(...c.bins.map(x => Math.abs(x.bSecs - x.aSecs)))).toBeLessThan(5)
  })

  it('a stretch can be compared even when B went round in another order', () => {
    const a = asPoints(boat(bend(), () => 3))
    // B: the second half first, then back to the start, then the first half (faster).
    const second = boat(bend().slice(2), () => 3)
    const back = boat([[1100, 1100], [0, 0]], () => 4).map(p => ({ ...p, t: p.t + second[second.length - 1].t + 1 }))
    const first = boat([[0, 0], [0, 1000]], () => 3.5).map(p => ({ ...p, t: p.t + back[back.length - 1].t + 1 }))
    const b = asPoints([...second, ...back, ...first])
    const i0 = a.findIndex(p => (p.lat - LAT0) * 110_540 >= 100), i1 = a.findIndex(p => (p.lat - LAT0) * 110_540 >= 800)
    const r = compareSection(a, b, i0, i1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.compare.total.bSecs).toBeLessThan(r.compare.total.aSecs)   // B was faster on that stretch
      expect(Math.max(...r.compare.bins.map(x => x.gapM))).toBeLessThan(3)
    }
  })

  it("says so when B never paddled the stretch, or it's too short", () => {
    const a = asPoints(boat(bend(), () => 3))
    const b = asPoints(boat([[0, 0], [0, 400]], () => 3))
    const i0 = a.findIndex(p => (p.lat - LAT0) * 110_540 >= 600), i1 = a.findIndex(p => (p.lat - LAT0) * 110_540 >= 950)
    expect(compareSection(a, b, i0, i1)).toEqual({ ok: false, reason: 'b_missed' })
    expect(compareSection(a, b, 10, 20)).toEqual({ ok: false, reason: 'too_short' })
  })
})

describe('club outings (both start and finish at the same spot)', () => {
  // Out 1.5 km and back on the same line, ending exactly where it started.
  const club: [number, number][] = [[0, 0], [0, 1500], [5, 1500], [0, 0]]

  it("matches B from the start, not from A's finish at the same spot", () => {
    // B starts 3 m from the club, i.e. nearer A's last point than its first.
    const a = boat(club, () => 3), b = boat(club.map(([x, y]) => [x + 3, y] as [number, number]), () => 3.2)
    const c = compareLines(a, b)!
    expect(c.fromM).toBeLessThan(50)
    expect(c.toM - c.fromM).toBeGreaterThan(2800)
  })

  it('a boat drifting back down the route is not a pass, however small each step', () => {
    const a = boat([[0, 0], [0, 1500]], () => 3)
    const down = boat([[0, 1500], [0, 0]], () => 4)       // the whole way, the wrong way
    expect(compareLines(a, down)).toBeNull()
  })
})

