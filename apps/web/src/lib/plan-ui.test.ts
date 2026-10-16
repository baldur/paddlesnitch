// The planner page's wording and address-bar state (plan-ui.ts).
import { describe, expect, it } from 'vitest'
import type { Stop } from '@paddlesnitch/waterways/plan'
import type { Feature } from '@paddlesnitch/waterways/types'
import { asInput, draftFromParams, draftParams, groupOf, localInput, mapTiles, placeClick, stopLines, type PlanDraft } from './plan-ui'

const feature = (over: Partial<Feature>): Feature => ({
  id: 'x', kind: 'lock', name: 'Cookham Lock', at: [51.56, -0.71],
  source: { source: 'ea-thames-locks', fetchedAt: '2026-10-11T00:00:00Z' }, ...over,
})
const stop = (f: Feature, over: Partial<Stop> = {}): Stop => ({
  feature: f, leg: 'out', chainageM: 1000, fromPrevM: 1000, portage: f.kind === 'lock',
  portagesBefore: 0, elapsedS: 450, ...over,
})

describe('what a stop says', () => {
  it("says a lock's portage side is unknown rather than guessing one", () => {
    expect(stopLines(stop(feature({}))) ).toContain('Portage side not known yet.')
    expect(stopLines(stop(feature({ portage: { side: 'left', carryM: 82 } })))).toEqual(
      expect.arrayContaining(['Portage on the left bank.', 'Carry about 82 m.']),
    )
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

  it('is the dark map by default', () => {
    expect(mapTiles(false).base).toContain('/World_Dark_Gray_Base/')
  })
})
