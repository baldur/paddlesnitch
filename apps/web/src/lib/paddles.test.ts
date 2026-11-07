import { describe, it, expect } from 'vitest'
import {
  isPhonePaddle, alsoRecordedBy, weekStart, weeklyKm, weekStreak, monthKm, groupSameOuting, sameOuting, sameOutingLinks, paddlingSummary,
  placesGap, encodePlaces, decodePlaces, overlapsInTime, PLACES_EVERY_S, type OutingPlaces,
} from '@paddlesnitch/core/paddles'

// Where a boat heading north at 2.2 m/s from 09:00 on 6 Oct was at each
// instant of `places` from `at` for `durationS`, on longitude `lng`, `offsetM`
// metres further north.
function placesOf(at: string, durationS: number, lng = -0.93, offsetM = 0): OutingPlaces {
  const start = Date.parse(at) / 1000, base = Date.parse('2026-10-06T09:00:00Z') / 1000
  const from = Math.ceil(start / PLACES_EVERY_S) * PLACES_EVERY_S
  const n = Math.floor((start + durationS - from) / PLACES_EVERY_S) + 1
  return encodePlaces(from, PLACES_EVERY_S, Array.from({ length: n }, (_, i) =>
    [51.46 + ((from + i * PLACES_EVERY_S - base) * 2.2 + offsetM) / 110_540, lng] as [number, number]))
}

// A phone's paddle (C3) has the tracker's source shape; only the device ID differs (#789).
describe('isPhonePaddle', () => {
  it('is true only for a device paddle whose device is a phone', () => {
    expect(isPhonePaddle({ type: 'device', deviceId: 'P0123456789ABCDEF' })).toBe(true)
    expect(isPhonePaddle({ type: 'device', deviceId: 'A1B2C3D4' })).toBe(false)
    expect(isPhonePaddle({ type: 'device' })).toBe(false)
    expect(isPhonePaddle({ type: 'file', deviceId: 'P0123456789ABCDEF' })).toBe(false)
    expect(isPhonePaddle(undefined)).toBe(false)
    expect(isPhonePaddle({ type: 'device', phone: true })).toBe(true)   // what others and the apps get
  })

  it('a tracker leads a same outing over a phone, whichever is newer', () => {
    const at = '2026-10-01T07:00:00Z'
    const p = (id: string, deviceId: string) => ({ id, paddledAt: at, distanceKm: 5, durationS: 3600, source: { type: 'device', deviceId }, places: placesOf(at, 3600) })
    const [g] = groupSameOuting([p('phone', 'P0123456789ABCDEF'), p('tracker', 'A1B2C3D4')])
    expect(g.lead.id).toBe('tracker')
    expect(g.others.map(o => o.id)).toEqual(['phone'])
  })
})

// The logbook on /paddles.
describe('alsoRecordedBy (one name per source, list and paddle page alike)', () => {
  it('names each source as "Also recorded by …" says it', () => {
    expect(alsoRecordedBy({ type: 'device' })).toBe('the tracker')
    expect(alsoRecordedBy({ type: 'device', phone: true })).toBe('the phone')
    expect(alsoRecordedBy({ type: 'device', deviceId: 'P0123456789ABCDEF' })).toBe('the phone')
    expect(alsoRecordedBy({ type: 'strava' })).toBe('Strava')
    expect(alsoRecordedBy({ type: 'trial' })).toBe('a time trial')
    expect(alsoRecordedBy({ type: 'file' })).toBe('a file')
  })
  it('an unknown source reads as a file, never a raw type', () => {
    expect(alsoRecordedBy({ type: 'watch-2030' })).toBe('a file')
  })
})

describe('logbook', () => {
  const p = (at: string, km = 5, durationS = 3600, type = 'file') => ({ paddledAt: at, distanceKm: km, durationS, source: { type } })
  const NOW = new Date('2026-10-07T12:00:00Z')   // a Wednesday

  it('counts weeks from Monday', () => {
    expect(weekStart(new Date('2026-10-07T12:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z')
    expect(weekStart(new Date('2026-10-05T00:30:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z')
    expect(weekStart(new Date('2026-10-04T23:30:00Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z')
  })

  it('adds up kilometres per week, this week last', () => {
    const w = weeklyKm([p('2026-10-06T08:00:00Z', 4), p('2026-10-01T08:00:00Z', 6), p('2026-09-30T08:00:00Z', 2.5), p('2025-01-01T08:00:00Z', 99)], NOW, 4)
    expect(w.map(x => x.km)).toEqual([0, 0, 8.5, 4])
    expect(w[3].week).toBe('2026-10-05')
  })

  it('counts a streak of weeks, not broken before the first paddle of this week', () => {
    expect(weekStreak([p('2026-10-01T08:00:00Z'), p('2026-09-24T08:00:00Z'), p('2026-09-03T08:00:00Z')], NOW)).toBe(2)
    expect(weekStreak([p('2026-10-06T08:00:00Z'), p('2026-10-01T08:00:00Z')], NOW)).toBe(2)
    expect(weekStreak([p('2026-09-03T08:00:00Z')], NOW)).toBe(0)
  })

  it('compares this month with last', () => {
    expect(monthKm([p('2026-10-02T08:00:00Z', 3), p('2026-09-30T08:00:00Z', 7), p('2026-08-30T08:00:00Z', 1)], NOW)).toEqual({ thisMonth: 3, lastMonth: 7 })
  })

  it('shows one outing recorded twice once, led by the tracker', () => {
    const strava = { ...p('2026-10-06T09:01:00Z', 8.1, 3500, 'strava'), id: 's', places: placesOf('2026-10-06T09:01:00Z', 3500) }
    const tracker = { ...p('2026-10-06T09:00:00Z', 8, 3600, 'device'), id: 't', places: placesOf('2026-10-06T09:00:00Z', 3600) }
    const other = { ...p('2026-10-01T09:00:00Z', 5, 3600, 'file'), id: 'o', places: placesOf('2026-10-01T09:00:00Z', 3600) }
    const g = groupSameOuting([strava, tracker, other])
    expect(g.map(x => [x.lead.id, x.others.map(o => o.id)])).toEqual([['t', ['s']], ['o', []]])
  })
})

// #852: the list grouped by time alone while the paddle page also needed the
// tracks to agree in place. One rule now, for both.
describe('sameOuting (the list, the paddle page and Compare)', () => {
  const at = '2026-10-06T09:00:00Z', later = '2026-10-06T09:00:30Z'
  const rec = (id: string, start: string, durationS: number, extra: object = {}, type = 'device') =>
    ({ id, paddledAt: start, distanceKm: 4, durationS, source: { type }, places: placesOf(start, durationS), ...extra })

  it('is not the same outing at the same time on another river (~2 km away)', () => {
    const tracker = rec('t', at, 1200), elsewhere = rec('e', later, 1100, { places: placesOf(later, 1100, -0.9) })
    expect(sameOuting(tracker, elsewhere)).toBe(false)
    expect(groupSameOuting([tracker, elsewhere]).map(g => g.others.length)).toEqual([0, 0])
  })

  it('is not the same outing for a phone left on the bank while the boat went on', () => {
    const tracker = rec('t', at, 1200)
    const still = decodePlaces(placesOf(at, 1200)).map(() => [51.46, -0.93] as [number, number])
    const bank = rec('b', at, 1200, { places: encodePlaces(placesOf(at, 1200).from, PLACES_EVERY_S, still) })
    expect(sameOuting(tracker, bank)).toBe(false)
  })

  it('is the same outing when both overlap in time and in place', () => {
    const tracker = rec('t', at, 1200), phone = rec('p', later, 1100)
    expect(sameOuting(tracker, phone)).toBe(true)
    expect(groupSameOuting([phone, tracker]).map(g => [g.lead.id, g.others.map(o => o.id)])).toEqual([['t', ['p']]])
  })

  it('is not the same outing in the same place at another time', () => {
    expect(sameOuting(rec('a', at, 1200), rec('b', '2026-10-07T09:00:00Z', 1200))).toBe(false)
  })

  it('needs places on both: a summary without them is never grouped', () => {
    expect(sameOuting(rec('t', at, 1200), rec('p', later, 1100, { places: undefined }))).toBe(false)
  })

  // Review of #891: grouping chained through a middle recording, so a card
  // named a recording the lead's page didn't, and the order of the list decided.
  it('joins a recording to a group only if it is the same outing as the lead, whatever the order', () => {
    // Rank order is tracker, Strava, file: the middle recording (the watch) is
    // placed before the outlier, so joining through any member would chain.
    const tracker = rec('A', at, 1200)                                                         // the boat
    const watch = rec('C', later, 1100, { places: placesOf(later, 1100, -0.93, 30) }, 'strava') // 30 m off it
    const file = rec('D', at, 1200, { places: placesOf(at, 1200, -0.93, 60) }, 'file')          // 60 m off it, 30 m off the watch
    expect([sameOuting(tracker, watch), sameOuting(watch, file), sameOuting(tracker, file)]).toEqual([true, true, false])
    for (const list of [[tracker, file, watch], [file, watch, tracker], [watch, tracker, file], [file, tracker, watch]]) {
      const groups = groupSameOuting(list)
      expect(groups.map(g => [g.lead.id, g.others.map(o => o.id)]).sort()).toEqual([['A', ['C']], ['D', []]])
      expect(sameOutingLinks(groups, 'A').map(o => o.id)).toEqual(['C'])
      expect(sameOutingLinks(groups, 'C').map(o => o.id)).toEqual(['A'])
      expect(sameOutingLinks(groups, 'D')).toEqual([])
    }
  })

  it('links a group of three: the lead to both, each other recording to the lead only', () => {
    const tracker = rec('A', at, 1200)
    const watch = rec('C', later, 1100, { places: placesOf(later, 1100, -0.93, 30) }, 'strava')
    const file = rec('E', at, 1200, { places: placesOf(at, 1200, -0.93, -30) }, 'file')         // 30 m the other way: 60 m off the watch
    const groups = groupSameOuting([file, watch, tracker])
    expect(groups.map(g => [g.lead.id, g.others.map(o => o.id)])).toEqual([['A', ['C', 'E']]])
    expect(sameOutingLinks(groups, 'A').map(o => o.id)).toEqual(['C', 'E'])
    expect(sameOutingLinks(groups, 'C').map(o => o.id)).toEqual(['A'])
    expect(sameOutingLinks(groups, 'E').map(o => o.id)).toEqual(['A'])
  })
})

// Every threshold of the rule, from both sides of its edge.
describe('sameOuting, at the edges', () => {
  const from = Date.parse('2026-10-06T09:00:00Z') / 1000
  const here: [number, number] = [51.46, -0.93]
  const north = (m: number): [number, number] => [here[0] + m / 110_540, here[1]]
  const pl = (pts: ([number, number] | null)[]) => encodePlaces(from, PLACES_EVERY_S, pts)
  const same = (n: number) => pl(Array.from({ length: n }, () => here))

  it('needs three shared instants, not two', () => {
    expect(placesGap(same(3), same(3))?.samples).toBe(3)
    expect(placesGap(same(2), same(2))).toBeNull()
    expect(placesGap(same(3), pl([here, here, null]))).toBeNull()                        // a gap is no instant
  })

  it('counts within 40 m as agreeing and beyond it as not (at the 1 m the summary keeps)', () => {
    // 36 and 37 units of 1e-5 degrees north: 39.8 m and 40.9 m.
    expect(placesGap(same(3), pl([north(39.8), north(39.8), north(39.8)]))?.agreement).toBe(1)
    expect(placesGap(same(3), pl([north(40.9), north(40.9), north(40.9)]))?.agreement).toBe(0)
    expect(placesGap(same(3), pl([north(39), north(39), north(39)]))?.agreement).toBe(1)
    expect(placesGap(same(3), pl([north(41), north(41), north(41)]))?.agreement).toBe(0)
  })

  it('is the same outing at 7 of 10 instants agreeing, not at 6', () => {
    const outing = (near: number) => ({ paddledAt: '2026-10-06T09:00:00Z', durationS: 180, places: pl(Array.from({ length: 10 }, (_, i) => (i < near ? here : north(100)))) })
    const base = { paddledAt: '2026-10-06T09:00:00Z', durationS: 180, places: same(10) }
    expect(sameOuting(base, outing(7))).toBe(true)
    expect(sameOuting(base, outing(6))).toBe(false)
  })

  it('needs half the shorter one inside the other in time: 51% is, 49% is not', () => {
    const a = { paddledAt: '2026-10-06T09:00:00Z', durationS: 600, places: same(31) }
    const b = (startS: number) => ({ paddledAt: new Date((from + startS) * 1000).toISOString(), durationS: 600, places: same(31) })
    expect(sameOuting(a, b(294))).toBe(true)                                              // 306 s of 600 shared
    expect(sameOuting(a, b(306))).toBe(false)                                             // 294 s of 600
  })
})

describe('overlapsInTime (lists of any size)', () => {
  it('finds the overlaps among 5000 paddles quickly, checking neighbours only', () => {
    const t0 = Date.parse('2020-01-01T08:00:00Z')
    // One paddle a day, and every tenth day a second recording of it.
    const list = Array.from({ length: 5000 }, (_, i) => {
      const day = i % 10 === 9 ? i - 1 : i
      return { paddledAt: new Date(t0 + day * 86_400_000 + (i % 10 === 9 ? 30_000 : 0)).toISOString(), durationS: 3600 }
    })
    const started = performance.now()
    const near = overlapsInTime(list)
    expect(performance.now() - started).toBeLessThan(500)
    expect(near.filter(n => n.length).length).toBe(1000)
    expect(near[9]).toEqual([8])
  })
})
describe('paddlingSummary (your own profile)', () => {
  const q = (id: string, at: string, km: number, speed: number) => ({ id, paddledAt: at, distanceKm: km, durationS: 3600, cruiseSpeed: speed })
  it('picks this year, the longest and the fastest cruise, with links', () => {
    const s = paddlingSummary([q('a', '2026-03-01T08:00:00Z', 12, 2.8), q('b', '2026-10-01T08:00:00Z', 6, 3.4), q('c', '2025-12-30T08:00:00Z', 20, 3.0)], new Date('2026-10-07T12:00:00Z'))
    expect(s.thisYearKm).toBe(18)
    expect(s.longest?.id).toBe('c')
    expect(s.fastest?.id).toBe('b')
    expect(s.count).toBe(3)
  })
})
