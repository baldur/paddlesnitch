import { describe, it, expect } from 'vitest'
import { areaName, fetchSiteAllowed, hostAllowed, isJson, layoutPins, originAllowed, otherPasses, route, scoreOf, stripOrder } from './explore'

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
  const pin = (x: number, distance: 'near' | 'mid' | 'far', label = 'trees') => ({ x, distance, label })
  const overlap = (a: { px: number; py: number; w: number }, b: { px: number; py: number; w: number }, viewPx: number) =>
    a.px < b.px + b.w && b.px < a.px + a.w && Math.abs(a.py - b.py) * viewPx * 0.625 < 23.9

  it('places pins across by x and down by distance, far higher than near', () => {
    const [far, near] = layoutPins([pin(0.2, 'far'), pin(0.8, 'near')])
    expect(far.px + far.w / 2).toBeCloseTo(0.2)
    expect(far.py).toBeLessThan(near.py)
  })
  it('labels never overlap at the sizes the page shows pictures, even long ones close together', () => {
    for (const viewPx of [290, 400, 560]) {
      const pins = layoutPins([pin(0.5, 'mid', 'moored-narrowboat ×2'), pin(0.6, 'mid', 'moored-cruiser'), pin(0.55, 'mid'), pin(0.9, 'mid'), pin(0.52, 'near', 'bridge')], viewPx)
      for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) expect(overlap(pins[i], pins[j], viewPx)).toBe(false)
    }
  })
  it('a label is as wide as its text needs on a smaller picture', () => {
    expect(layoutPins([pin(0.5, 'mid', 'moored-narrowboat')], 290)[0].w).toBeGreaterThan(layoutPins([pin(0.5, 'mid', 'moored-narrowboat')], 560)[0].w)
  })
  it('labels at the edges stay inside the picture', () => {
    for (const p of layoutPins([pin(0, 'mid', 'moored-narrowboat'), pin(1, 'far', 'pub-restaurant')])) {
      expect(p.px).toBeGreaterThanOrEqual(0)
      expect(p.px + p.w).toBeLessThanOrEqual(1)
    }
  })
  it('a pile of pins at one place spreads up the picture instead of stacking at the bottom', () => {
    const pins = layoutPins(Array.from({ length: 8 }, () => pin(0.5, 'near')), 560)
    expect(new Set(pins.map((p) => p.py.toFixed(3))).size).toBe(8)
    expect(Math.max(...pins.map((p) => p.py))).toBeLessThanOrEqual(0.94 + 1e-9)
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
  const spot = (id: number, chapterId: number, day: string | null, dLat: number) => ({ id, chapterId, startUtc: day && `${day}T09:00:00Z`, lat: 51.46 + dLat, lng: -0.97 })
  it('finds the closest spot from each clip filmed on another day, within range', () => {
    const at = spot(1, 1, '2026-11-08', 0)
    const spots = [at, spot(2, 1, '2026-11-08', 0.0001), spot(3, 2, '2026-11-01', 0.0002), spot(4, 2, '2026-11-01', 0.0001), spot(5, 3, '2026-10-01', 0.01)]
    expect(otherPasses(spots, at).map((s) => s.id)).toEqual([4])
  })
  it("the recording's next chapter, or the way back on the same paddle, is not another day", () => {
    const at = spot(1, 1, '2026-11-08', 0)
    expect(otherPasses([at, spot(2, 2, '2026-11-08', 0.0001)], at)).toEqual([])
  })
  it('clips without a date count as their own day', () => {
    const at = spot(1, 1, null, 0)
    expect(otherPasses([at, spot(2, 2, null, 0.0001)], at).map((s) => s.id)).toEqual([2])
  })
})

describe('who the server answers', () => {
  it('only this machine, on its own port', () => {
    expect(hostAllowed('localhost:3201', 3201)).toBe(true)
    expect(hostAllowed('127.0.0.1:3201', 3201)).toBe(true)
    expect(hostAllowed('evil.example:3201', 3201)).toBe(false)
    expect(hostAllowed(undefined, 3201)).toBe(false)
  })
  it("refuses another site's page, even through an <img>; the page itself opens from anywhere", () => {
    expect(fetchSiteAllowed('cross-site', false)).toBe(false)
    expect(fetchSiteAllowed('same-site', false)).toBe(false)
    expect(fetchSiteAllowed('same-origin', false)).toBe(true)
    for (const site of ['cross-site', 'same-site', 'same-origin', 'none', undefined]) expect(fetchSiteAllowed(site, true)).toBe(true)
  })
  it('data and pictures only from the page, so an old browser that says nothing gets nothing', () => {
    expect(fetchSiteAllowed('none', false)).toBe(false)
    expect(fetchSiteAllowed(undefined, false)).toBe(false)
  })
  it('takes JSON with or without a charset, nothing else', () => {
    expect(isJson('application/json')).toBe(true)
    expect(isJson('application/json; charset=utf-8')).toBe(true)
    expect(isJson('text/plain')).toBe(false)
    expect(isJson('application/jsonp')).toBe(false)
    expect(isJson(undefined)).toBe(false)
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
    expect(route('GET', '/view/12/45.jpg').kind).toBe('none')
    expect(route('GET', '/view/../../etc/passwd').kind).toBe('none')
    expect(route('GET', '/api/review').kind).toBe('none')
    expect(route('POST', '/api/review').kind).toBe('review')
    expect(route('GET', '/view/12/90.jpg')).toEqual({ kind: 'view', id: 12, yaw: 90, careful: false })
    expect(route('GET', '/view/12/l45.jpg')).toEqual({ kind: 'view', id: 12, yaw: 45, careful: true })
    expect(route('GET', '/view/12/l50.jpg').kind).toBe('none')
    expect(route('GET', '/api/area/3')).toEqual({ kind: 'area', id: 3 })
    expect(route('POST', '/api/area').kind).toBe('saveArea')
    expect(route('GET', '/api/area-spots').kind).toBe('areaSpots')
    expect(route('GET', '/api/areas').kind).toBe('areas')
  })
})

describe('areaName', () => {
  it('keeps one line of 1–60 characters, and nothing else', () => {
    expect(areaName('  Fry\'s Island\n boathouses ')).toBe("Fry's Island boathouses")
    expect(areaName('')).toBeNull()
    expect(areaName('x'.repeat(61))).toBeNull()
    expect(areaName(null)).toBeNull()
    expect(areaName('Fry\u001b[2Js')).toBe('Fry[2Js')
  })
})
