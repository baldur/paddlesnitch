import { describe, it, expect } from 'vitest'
import { hostAllowed, layoutPins, originAllowed, otherPasses, route, scoreOf, stripOrder } from './explore'

describe('stripOrder', () => {
  it('puts the bow in the middle: left, ahead, right, behind', () => {
    // Camera on the back deck looking back: lens 180 looks ahead.
    expect(stripOrder(180).map((v) => [v.name, v.viewYaw])).toEqual([['left', 90], ['ahead', 180], ['right', 270], ['behind', 0]])
    expect(stripOrder(0).map((v) => [v.name, v.viewYaw])).toEqual([['left', 270], ['ahead', 0], ['right', 90], ['behind', 180]])
  })
  it('assumes the usual back-deck camera when the clip has no direction yet', () => {
    expect(stripOrder(null)).toEqual(stripOrder(180))
  })
  it('names views by the nearest side when the camera was set at an odd angle', () => {
    expect(stripOrder(170).map((v) => v.name)).toEqual(['left', 'ahead', 'right', 'behind'])
  })
})

describe('layoutPins', () => {
  it('places pins across by x and down by distance, far higher than near', () => {
    const [far, near] = layoutPins([{ x: 0.2, distance: 'far' as const }, { x: 0.8, distance: 'near' as const }])
    expect(far.px).toBe(0.2)
    expect(far.py).toBeLessThan(near.py)
  })
  it('moves a pin down a row instead of on top of another', () => {
    const [a, b, c] = layoutPins([{ x: 0.5, distance: 'mid' as const }, { x: 0.52, distance: 'mid' as const }, { x: 0.9, distance: 'mid' as const }])
    expect(b.py).toBeGreaterThan(a.py)
    expect(c.py).toBe(a.py)
  })
  it('keeps every pin on the picture however many pile up', () => {
    const pins = layoutPins(Array.from({ length: 30 }, () => ({ x: 0.5, distance: 'near' as const })))
    expect(Math.max(...pins.map((p) => p.py))).toBeLessThanOrEqual(0.96)
  })
})

describe('scoreOf', () => {
  it('has no rate until something is checked', () => {
    expect(scoreOf([], 0)).toMatchObject({ checked: 0, rate: null, byKind: [] })
  })
  it('counts right, made up and missed, and breaks it down by kind, most checked first', () => {
    const s = scoreOf([
      { kind: 'bridge', verdict: 'right' }, { kind: 'swan', verdict: 'wrong' }, { kind: 'swan', verdict: 'right' }, { kind: 'swan', verdict: 'wrong' },
    ], 2)
    expect(s).toMatchObject({ checked: 4, right: 2, wrong: 2, missed: 2, rate: 0.5 })
    expect(s.byKind).toEqual([{ kind: 'swan', right: 1, wrong: 2, rate: 1 / 3 }, { kind: 'bridge', right: 1, wrong: 0, rate: 1 }])
  })
})

describe('otherPasses', () => {
  const spot = (id: number, chapterId: number, dLat: number) => ({ id, chapterId, lat: 51.46 + dLat, lng: -0.97 })
  it('finds the closest spot from each other clip, not this one, within range', () => {
    const at = spot(1, 1, 0)
    const spots = [at, spot(2, 1, 0.0001), spot(3, 2, 0.0002), spot(4, 2, 0.0001), spot(5, 3, 0.01)]
    expect(otherPasses(spots, at).map((s) => s.id)).toEqual([4])
  })
})

describe('who the server answers', () => {
  it('only this machine, on its own port', () => {
    expect(hostAllowed('localhost:3201', 3201)).toBe(true)
    expect(hostAllowed('127.0.0.1:3201', 3201)).toBe(true)
    expect(hostAllowed('evil.example:3201', 3201)).toBe(false)
    expect(hostAllowed(undefined, 3201)).toBe(false)
  })
  it('changes only from its own page', () => {
    expect(originAllowed('http://localhost:3201', 3201)).toBe(true)
    expect(originAllowed('https://evil.example', 3201)).toBe(false)
    expect(originAllowed(undefined, 3201)).toBe(false)
  })
})

describe('route', () => {
  it('knows its paths and takes only whole-number ids and real view angles', () => {
    expect(route('GET', '/api/spot/12')).toEqual({ kind: 'spot', id: 12 })
    expect(route('GET', '/view/12/90.jpg')).toEqual({ kind: 'view', id: 12, yaw: 90 })
    expect(route('GET', '/view/12/45.jpg').kind).toBe('none')
    expect(route('GET', '/view/../../etc/passwd').kind).toBe('none')
    expect(route('GET', '/api/review').kind).toBe('none')
    expect(route('POST', '/api/review').kind).toBe('review')
  })
})
