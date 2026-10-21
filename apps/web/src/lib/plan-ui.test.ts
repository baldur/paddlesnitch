// The planner page's wording and address-bar state (plan-ui.ts).
import { describe, expect, it } from 'vitest'
import type { Stop } from '@paddlesnitch/waterways/plan'
import type { Feature, LatLng } from '@paddlesnitch/waterways/types'
import type { PortageOnRoute } from '@paddlesnitch/waterways/portage'
import { lineLength } from '@paddlesnitch/waterways/line'
import { addPortageHref, lockFromParams, portageMap, daylightSummary, isDarkStop, crewLines, isCrewStop, printHref, shownGroups, asInput, draftFromParams, draftParams, groupOf, localInput, mapTiles, inNetherlands, pixelsToMetres, placeClick, stopId, stopLines, type PlanDraft } from './plan-ui'

const feature = (over: Partial<Feature>): Feature => ({
  id: 'x', kind: 'lock', name: 'Cookham Lock', at: [51.56, -0.71],
  source: { source: 'ea-thames-locks', fetchedAt: '2026-10-11T00:00:00Z' }, ...over,
})
const stop = (f: Feature, over: Partial<Stop> = {}): Stop => ({
  feature: f, leg: 'out', chainageM: 1000, fromPrevM: 1000, portage: f.kind === 'lock',
  portagesBefore: 0, elapsedS: 450, ...over,
})

describe("a stop's id in the page (#510)", () => {
  it('is its leg and feature id, safe to use as an HTML id', () => {
    expect(stopId(stop(feature({ id: 'crt:locks:OX-076-001' })))).toBe('stop-out-crt-locks-OX-076-001')
    expect(stopId(stop(feature({ id: 'crt:locks:OX-076-001' }), { leg: 'back' }))).toBe('stop-back-crt-locks-OX-076-001')
  })
})

describe('what a stop says', () => {
  it("says a lock's portage side is unknown rather than guessing one", () => {
    expect(stopLines(stop(feature({}))) ).toContain('Portage side not known yet.')
    expect(stopLines(stop(feature({ portage: { side: 'left', carryM: 82 } })))).toEqual(
      expect.arrayContaining(['Portage on the left bank.', 'Carry about 82 m.']),
    )
  })

  it("says a canal's bywash weir is beside the way, with nothing to portage (#509)", () => {
    const weir = feature({ kind: 'weir', name: 'Weir 21' })
    expect(stopLines(stop(weir, { beside: true }))).toContain('Beside the canal, not across it: nothing to portage.')
    expect(stopLines(stop(weir))).not.toContain('Beside the canal, not across it: nothing to portage.')
  })

  it('gives a crew how to get there, where to park, the postcode and facilities', () => {
    const lines = stopLines(stop(feature({
      lock: { postcode: 'SL6 9SR', facilities: ['toilet', 'drinking_water'] },
      crew: { directions: 'Walk across the weir from the car park.', parking: 'National Trust car park.' },
    })))
    expect(lines).toEqual([
      'Portage side not known yet.',
      'Walk across the weir from the car park.',
      'Parking: National Trust car park.',
      'Postcode SL6 9SR.',
      'Facilities: toilet, drinking water.',
    ])
  })

  it('says which bank a towpath access point is on, in the direction of travel', () => {
    const f = feature({ kind: 'crew_point', name: 'Towpath access', crew: { directions: 'Steps, 1.2 m wide.' } })
    expect(stopLines(stop(f, { bank: 'right' }))).toEqual(['On the right bank.', 'Steps, 1.2 m wide.'])
  })

  it('groups kinds for the filters', () => {
    expect(['lock', 'portage', 'weir', 'slipway', 'access', 'facility', 'crew_point'].map(k => groupOf(k as Feature['kind'])))
      .toEqual(['portage', 'portage', 'weir', 'access', 'access', 'facility', 'crew'])
  })
})

describe('an unsaved plan in the address bar', () => {
  const draft: PlanDraft = {
    start: [51.355333, -1.994961], finish: [51.500833, -0.121667], shape: 'return',
    startAt: '2027-04-17T07:00:00.000Z', paceKmh: 9.5, portageMinutes: 4,
  }

  it('round-trips', () => {
    const q = draftParams(draft)
    expect(q).toBe('from=51.355333,-1.994961&to=51.500833,-0.121667&shape=return&at=2027-04-17T07:00:00.000Z&pace=9.5&portage=4')
    expect(draftFromParams(Object.fromEntries(new URLSearchParams(q))).draft).toEqual(draft)
  })

  it('leaves defaults out, and fills them back in', () => {
    const plain: PlanDraft = { start: null, finish: null, shape: 'one_way', paceKmh: 8, portageMinutes: 3 }
    expect(draftParams(plain)).toBe('')
    expect(draftFromParams({}).draft).toEqual(plain)
  })

  it('ignores nonsense', () => {
    const { draft: d, view } = draftFromParams({ from: '91,0', to: 'abc', pace: '-4', portage: '999', at: 'soon', view: '1,2' })
    expect(d).toEqual({ start: null, finish: null, shape: 'one_way', paceKmh: 1, portageMinutes: 120, startAt: undefined })
    expect(view).toBeUndefined()
    expect(draftFromParams({ view: '51.45,-0.95,15' }).view).toEqual({ at: [51.45, -0.95], zoom: 15 })
  })

  it('is a plan only with both ends', () => {
    expect(asInput({ ...draft, finish: null })).toBeNull()
    expect(asInput(draft)).toMatchObject({ start: draft.start, finish: draft.finish })
  })
})

describe('clicks', () => {
  it('ten pixels on the map is tens of metres at zoom 14, less closer in and further north', () => {
    expect(pixelsToMetres(0, 14)).toBeCloseTo(95.5, 0)
    expect(pixelsToMetres(52, 14)).toBeCloseTo(58.8, 0)
    expect(pixelsToMetres(52, 16)).toBeCloseTo(pixelsToMetres(52, 14) / 4, 6)
  })

  const empty: PlanDraft = { start: null, finish: null, shape: 'one_way', paceKmh: 8, portageMinutes: 3 }
  it('set the start, then the finish, then move whichever end is nearer', () => {
    const a = placeClick(empty, [51.0, -1.0])
    expect(a.start).toEqual([51.0, -1.0])
    const b = placeClick(a, [51.0, -0.5])
    expect(b.finish).toEqual([51.0, -0.5])
    expect(placeClick(b, [51.0, -0.9]).start).toEqual([51.0, -0.9])
    expect(placeClick(b, [51.0, -0.6]).finish).toEqual([51.0, -0.6])
  })

  it('move an end that missed the water, so a bad click can be fixed by clicking again', () => {
    // The start landed in a field: the next click moves it, instead of becoming the finish.
    const missed = placeClick(empty, [51.32, -1.2])
    expect(placeClick(missed, [51.0, -1.0], 'start')).toMatchObject({ start: [51.0, -1.0], finish: null })
    const both: PlanDraft = { ...empty, start: [51.0, -1.0], finish: [51.32, -1.2] }
    expect(placeClick(both, [51.0, -0.5], 'finish')).toMatchObject({ start: [51.0, -1.0], finish: [51.0, -0.5] })
  })
})

describe('the start time box', () => {
  it("shows an ISO time in the browser's zone", () => {
    const local = new Date(2027, 3, 17, 8, 5)
    expect(localInput(local.toISOString())).toBe('2027-04-17T08:05')
    expect(localInput(undefined)).toBe('')
  })
})

describe('the map tiles', () => {
  it('switches to Esri aerial imagery, with labels that read on a photo and the imagery credited', () => {
    const sat = mapTiles(true)
    expect(sat.base).toContain('/World_Imagery/')
    expect(sat.labels).toContain('/World_Boundaries_and_Places/')
    expect(sat.attribution).toContain('Esri, Vantor, Earthstar Geographics')
    expect(sat.baseNativeZoom).toBe(19)   // close enough to see a landing stage
  })

  it("over the Netherlands, the Kadaster's 8 cm aerial photos (printable, CC BY 4.0), credited", () => {
    const nl = mapTiles(true, true)
    expect(nl.base).toContain('service.pdok.nl/hwh/luchtfotorgb')
    expect(nl.attribution).toContain('Beeldmateriaal.nl (Kadaster), CC BY 4.0')
    expect(mapTiles(false, true).base).toContain('/World_Dark_Gray_Base/')   // only the satellite view changes
  })

  it('knows the Netherlands from its neighbours', () => {
    expect([[52.37, 4.90], [51.92, 4.48], [53.22, 6.57], [50.85, 5.69]].map(p => inNetherlands(p as [number, number]))).toEqual([true, true, true, true])   // Amsterdam, Rotterdam, Groningen, Maastricht
    expect([[51.22, 4.40], [51.45, 7.0], [51.5, -0.12], [52.6, 3.0]].map(p => inNetherlands(p as [number, number]))).toEqual([false, false, false, false])   // Antwerp, Essen, London, North Sea
  })

  it('is the dark map by default', () => {
    expect(mapTiles(false).base).toContain('/World_Dark_Gray_Base/')
  })
})

describe('the printed sheets', () => {
  const draft: PlanDraft = { start: [51.355333, -1.994961], finish: [51.500833, -0.121667], shape: 'one_way', paceKmh: 8, portageMinutes: 3 }

  it('carry the route, the plan behind it, the sheet and the stop kinds in the address', () => {
    expect(printHref(draft)).toBe('/plan/print?from=51.355333,-1.994961&to=51.500833,-0.121667')
    expect(printHref(draft, { id: 'abc', crew: true, show: ['portage', 'weir'] }))
      .toBe('/plan/print?from=51.355333,-1.994961&to=51.500833,-0.121667&show=portage,weir&id=abc&crew=1')
    expect(printHref(draft, { share: 'xyz' })).toContain('&share=xyz')
  })

  it("read the stop kinds back, ignoring ones that don't exist; none asked means the defaults", () => {
    expect([...shownGroups('portage,weir,nonsense')]).toEqual(['portage', 'weir'])
    expect([...shownGroups('')]).toEqual([])
    expect([...shownGroups(undefined)]).toEqual(['portage', 'weir', 'access', 'facility'])
  })

  it('the crew sheet keeps places a crew can reach, with postcode and parking; not towpath points', () => {
    const lock = feature({ crew: { postcode: 'SL6 9SR', parking: 'National Trust car park.', directions: 'Walk across the weir.' } })
    expect(isCrewStop(stop(lock))).toBe(true)
    expect(crewLines(stop(lock))).toEqual({ postcode: 'SL6 9SR', lines: ['Parking: National Trust car park.', 'Walk across the weir.'] })
    expect(isCrewStop(stop(feature({})))).toBe(false)                                      // a lock we can't direct anyone to
    expect(isCrewStop(stop(feature({ kind: 'slipway', name: 'Slipway' })))).toBe(true)
    expect(isCrewStop(stop(feature({ kind: 'crew_point', name: 'Towpath access' })))).toBe(false)
  })
})

describe('daylight', () => {
  const lock = feature({ at: [51.5, -0.9] })
  it('marks a stop reached before sunrise or after sunset; without a start time, nothing', () => {
    expect(isDarkStop(stop(lock, { eta: '2027-04-17T02:00:00.000Z' }))).toBe(true)
    expect(isDarkStop(stop(lock, { eta: '2027-04-17T12:00:00.000Z' }))).toBe(false)
    expect(isDarkStop(stop(lock))).toBe(false)
  })

  it('gives sunrise and sunset on the start day, and counts the stops in the dark', () => {
    const plan = {
      start: { at: [51.5, -0.9] as [number, number], waterway: 'River Thames' }, finish: { at: [51.5, -0.9] as [number, number], waterway: 'River Thames' },
      line: [], lengthM: 0, portages: 0, movingS: 0, totalS: 0, waterways: [],
      stops: [stop(lock, { eta: '2027-04-17T02:00:00.000Z' }), stop(lock, { eta: '2027-04-17T12:00:00.000Z' })],
    }
    const d = daylightSummary(plan, '2027-04-17T02:00:00.000Z')!
    expect(d.darkStops).toBe(1)
    expect(Date.parse(d.sunrise!)).toBeLessThan(Date.parse(d.sunset!))
    expect(daylightSummary(plan, undefined)).toBeNull()
  })
})

describe('adding portage details from a link', () => {
  it('round-trips a lock through the address, and refuses junk', () => {
    const href = addPortageHref({ id: 'ea-lock:hambleden', name: 'Hambleden Lock', at: [51.5604, -0.8687] })
    expect(href).toBe('/plan?lock=ea-lock:hambleden&lockAt=51.560400,-0.868700&lockName=Hambleden+Lock&view=51.560400,-0.868700,18')
    const params = Object.fromEntries(new URLSearchParams(href.split('?')[1]))
    expect(lockFromParams(params)).toEqual({ id: 'ea-lock:hambleden', name: 'Hambleden Lock', at: [51.5604, -0.8687] })
    expect(lockFromParams({ lock: 'x', lockAt: 'nowhere' })).toBeUndefined()
    expect(lockFromParams({ lockAt: '51,0' })).toBeUndefined()
  })
})

describe('portage maps for the printed sheet', () => {
  // A straight route heading east through a lock at [51.5, -0.995], landings on the north bank.
  const line: LatLng[] = [[51.5, -1.01], [51.5, -0.98]]
  const lock = { id: 'l', kind: 'lock' as const, at: [51.5, -0.995] as LatLng, source: { source: 'crt' as const, fetchedAt: '2026-10-19T00:00:00Z' } }
  const portage: PortageOnRoute = {
    id: 'p', by: 'Ann', carryM: 70,
    takeOut: { at: [51.5002, -0.9955], bank: 'left' }, putIn: { at: [51.5002, -0.9945], bank: 'left' },
  }
  const len = lineLength(line)
  const chainage = len / 2   // the lock is halfway

  it('centres on the lock, north up: the bank to your left heading east is above the line', () => {
    const map = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock }, portage)
    expect(map.lock).toEqual([110, 110])
    expect(map.takeOut[1]).toBeLessThan(110)
    expect(map.takeOut[0]).toBeLessThan(map.putIn[0])
    expect(map.route.startsWith('M')).toBe(true)
  })

  it('points the arrow the way you go, upstream of the lock, and on the way back reverses it', () => {
    const out = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock }, portage)
    expect(out.arrow.deg).toBe(90)
    expect(out.arrow.x).toBeLessThan(110)
    const back = portageMap(line, { chainageM: 2 * len - chainage, leg: 'back', feature: lock }, portage)
    expect(back.arrow.deg).toBe(270)
    expect(back.arrow.x).toBeGreaterThan(110)
  })

  it('a round-number scale bar about a quarter of the width', () => {
    const { scale, size } = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock }, portage)
    expect([10, 20, 25, 50, 100]).toContain(scale.m)
    expect(scale.px).toBeGreaterThan(size / 8)
    expect(scale.px).toBeLessThanOrEqual(size / 4)
  })
})
