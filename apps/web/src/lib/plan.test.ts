// River planner plans (@paddlesnitch/waterways/plan), computed on the real
// Devizes → Westminster dataset.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { computePlan, fmtDuration, snapClick, type ComputedPlan, type PlanInput } from '@paddlesnitch/waterways/plan'
import { REGIONS } from '@paddlesnitch/waterways/regions'
import type { LatLng, RegionDataset } from '@paddlesnitch/waterways/types'

const ds: RegionDataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8'))
const { start: DEVIZES, finish: WESTMINSTER } = REGIONS.dw.check!
const CAVERSHAM_BRIDGE: LatLng = [51.4677, -0.9776]
const BELOW_SONNING: LatLng = [51.4745, -0.9070]

const plan = (over: Partial<PlanInput>): ComputedPlan => {
  const p = computePlan(ds, { start: DEVIZES, finish: WESTMINSTER, shape: 'one_way', paceKmh: 8, portageMinutes: 3, ...over })
  if (typeof p === 'string') throw new Error(p)
  return p
}
const lockNames = (p: ComputedPlan, leg?: 'out' | 'back') =>
  p.stops.filter(s => s.feature.kind === 'lock' && (!leg || s.leg === leg)).map(s => s.feature.name)

describe('clicks snap to the water', () => {
  it('a click beside the canal lands on it', () => {
    const s = snapClick(ds, [DEVIZES[0] + 0.002, DEVIZES[1]])   // ~220 m north
    expect(s?.link.name).toBe('Kennet and Avon Canal')
    expect(s!.dist).toBeLessThan(300)
  })

  it("a click in a field isn't on the water", () => {
    const field: LatLng = [51.32, -1.20]   // on the Downs, 7 km from any river we cover
    expect(snapClick(ds, field)).toBeNull()
    expect(computePlan(ds, { start: field, finish: WESTMINSTER, shape: 'one_way', paceKmh: 8, portageMinutes: 3 })).toBe('start_off_water')
    expect(computePlan(ds, { start: DEVIZES, finish: field, shape: 'one_way', paceKmh: 8, portageMinutes: 3 })).toBe('finish_off_water')
  })

  it("the same click twice isn't a trip", () => {
    expect(computePlan(ds, { start: DEVIZES, finish: DEVIZES, shape: 'one_way', paceKmh: 8, portageMinutes: 3 })).toBe('too_short')
  })
})

describe('a one-way plan', () => {
  const p = plan({ startAt: '2026-04-04T08:00:00.000Z' })

  it('runs Devizes to Westminster with every lock a portage', () => {
    expect(p.start.waterway).toBe('Kennet and Avon Canal')
    expect(p.finish.waterway).toBe('River Thames')
    expect(p.lengthM / 1000).toBeGreaterThan(198)
    expect(p.lengthM / 1000).toBeLessThan(204)
    expect(p.portages).toBe(77)
    expect(lockNames(p)).toHaveLength(77)
    expect(p.turnM).toBeUndefined()
  })

  it('lists stops in travel order with the distance from the one before', () => {
    const ch = p.stops.map(s => s.chainageM)
    expect(ch).toEqual([...ch].sort((a, b) => a - b))
    const sum = p.stops.reduce((t, s) => t + s.fromPrevM, 0)
    expect(sum).toBeCloseTo(p.stops.at(-1)!.chainageM, 3)
    expect(p.stops.every(s => s.leg === 'out')).toBe(true)
  })

  it('times each stop at the pace plus the portages already done', () => {
    const teddington = p.stops.find(s => s.feature.name === 'Teddington Lock')!
    expect(teddington.portagesBefore).toBe(76)
    expect(teddington.elapsedS).toBeCloseTo(teddington.chainageM / (8000 / 3600) + 76 * 180, 3)
    expect(Math.abs(Date.parse(teddington.eta!) - (Date.parse('2026-04-04T08:00:00.000Z') + teddington.elapsedS * 1000))).toBeLessThan(1)
    expect(p.totalS).toBeCloseTo(p.movingS + 77 * 180, 3)
    expect(p.finishAt).toBe(new Date(Date.parse('2026-04-04T08:00:00.000Z') + p.totalS * 1000).toISOString())
  })

  it('gives no clock times without a start time', () => {
    const q = plan({})
    expect(q.finishAt).toBeUndefined()
    expect(q.stops.every(s => s.eta === undefined)).toBe(true)
  })

  it('a faster pace and slower portages change the times, not the stops', () => {
    const q = plan({ paceKmh: 10, portageMinutes: 6 })
    expect(q.stops.map(s => s.feature.id)).toEqual(p.stops.map(s => s.feature.id))
    expect(q.movingS).toBeCloseTo(p.movingS * 0.8, 3)
    expect(q.totalS).toBeCloseTo(q.movingS + 77 * 360, 3)
  })
})

describe('going the other way', () => {
  const down = plan({})
  const up = plan({ start: WESTMINSTER, finish: DEVIZES })

  it('meets the same locks in reverse order', () => {
    expect(up.portages).toBe(down.portages)
    expect(lockNames(up)).toEqual([...lockNames(down)].reverse())
  })

  it('flips which bank a crew point is on', () => {
    const banks = new Map(down.stops.filter(s => s.bank).map(s => [s.feature.id, s.bank]))
    const flipped = up.stops.filter(s => s.bank && banks.has(s.feature.id))
    expect(flipped.length).toBeGreaterThan(50)
    const agree = flipped.filter(s => s.bank !== banks.get(s.feature.id)).length
    expect(agree / flipped.length).toBeGreaterThan(0.95)   // a point on a bend can project either side
  })
})

describe('a return plan', () => {
  const one = plan({ start: CAVERSHAM_BRIDGE, finish: BELOW_SONNING })
  const ret = plan({ start: CAVERSHAM_BRIDGE, finish: BELOW_SONNING, shape: 'return' })

  it('goes out and comes back the same way', () => {
    expect(ret.lengthM).toBeCloseTo(one.lengthM * 2, 3)
    expect(ret.turnM).toBeCloseTo(one.lengthM, 3)
    expect(lockNames(one)).toEqual(['Caversham Lock', 'Sonning Lock'])
    expect(lockNames(ret, 'out')).toEqual(['Caversham Lock', 'Sonning Lock'])
    expect(lockNames(ret, 'back')).toEqual(['Sonning Lock', 'Caversham Lock'])
    expect(ret.portages).toBe(4)
  })

  it('counts the way back after the turn', () => {
    const back = ret.stops.filter(s => s.leg === 'back')
    expect(back.length).toBeGreaterThan(0)
    expect(back.every(s => s.chainageM >= ret.turnM!)).toBe(true)
    expect(ret.stops.at(-1)!.chainageM).toBeLessThanOrEqual(ret.lengthM)
  })
})

describe('durations', () => {
  it('reads as hours and minutes', () => {
    expect(fmtDuration(45 * 60)).toBe('45 min')
    expect(fmtDuration(3 * 3600 + 5 * 60)).toBe('3 h 05 min')
    expect(fmtDuration(29)).toBe('0 min')
  })
})

