// First-hand portage surveys (packages/waterways/src/portage-survey.ts) and the
// committed data/portage-survey.json.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { haversine } from '@paddlesnitch/timing/geo'
import { sideOf } from '@paddlesnitch/waterways/along'
import { cumulative, project } from '@paddlesnitch/waterways/line'
import { routePlan } from '@paddlesnitch/waterways/plan'
import { portageOnRoute, type PublicPortage } from '@paddlesnitch/waterways/portage'
import { withSurveyFeatures, gaugeNote, levelNote, mergeSurvey, readingAt, surveyEntry, surveyGauge, surveyPortages, SURVEY_NAME, uncheckedDrafts, withSurveyEntries, type SurveyDraft } from '@paddlesnitch/waterways/portage-survey'
import { GAUGE_STATE_TEXT } from './plan-ui'
import type { LatLng, RegionDataset } from '@paddlesnitch/waterways/types'

const NOON = '2026-11-08T12:00:00Z'
const gauge = { source: 'ea' as const, id: '2292BTH', name: 'Calcot', river: 'River Kennet', valueM: 1.892, flowM3s: 3.386, state: 'low' as const, readAt: NOON }
const draft: SurveyDraft = {
  featureId: 'crt:locks:KA-1', lock: 'Lock 1', at: [51.4, -1.1], landings: [[51.4001, -1.1001], [51.4001, -1.0999]],
  line: [[51.4, -1.11], [51.4, -1.09]], sides: ['left', 'left'],
  observed: { at: NOON, gauge }, takeOut: 'a low bank', putIn: 'a timber staging', carry: 'grass',
}

describe('the gauge reading for a moment', () => {
  const readings = [{ dateTime: '2026-11-08T11:45:00Z', value: 1 }, { dateTime: '2026-11-08T12:00:00Z', value: 2 }]
  it('is the closest one', () => expect(readingAt(readings, '2026-11-08T11:58:00Z')?.value).toBe(2))
  it('is nothing when the closest is over half an hour away', () => expect(readingAt(readings, '2026-11-08T14:00:00Z')).toBeUndefined())
})

describe('the conditions a paddler reads', () => {
  it('names the gauge\'s owner, the level against its usual range and the flow', () => {
    expect(gaugeNote(gauge)).toBe('Environment Agency gauge at Calcot read 1.89 m (below its usual range), flow 3.4 m³/s.')
  })
  it('leaves out what the gauge did not give', () => {
    expect(gaugeNote({ ...gauge, flowM3s: undefined, state: undefined })).toBe('Environment Agency gauge at Calcot read 1.89 m.')
  })
  it('uses the same words as Conditions on the same screen', () => {
    for (const state of ['low', 'normal', 'high'] as const) expect(gaugeNote({ ...gauge, state })).toContain(GAUGE_STATE_TEXT[state])
  })
  it('says nothing about a level for a record with no gauge', () => expect(levelNote('not-a-survey')).toBeUndefined())
})

describe('adding a checked carry', () => {
  it('builds the record Plan shows, under CC0 and with no person named', () => {
    const e = surveyEntry(draft)
    expect(e).toMatchObject({ id: 'survey-2026-11-08-KA-1', name: SURVEY_NAME, licence: 'CC0-1.0', featureId: 'crt:locks:KA-1' })
    expect(e.notes).toBe('Get out: a low bank. Back in: a timber staging. Carry: grass. Seen 8 Nov 2026.')
  })
  it('writes only the day, whatever time the draft held', () => {
    const e = surveyEntry({ ...draft, observed: { at: '2026-01-02T07:41:03.250Z', gauge: { ...gauge, readAt: '2026-01-02T07:45:00Z' } } })
    expect(JSON.stringify(e).match(/T[\d:.]+Z/g)!.every(t => t === 'T12:00:00.000Z')).toBe(true)
    expect(e.id).toBe('survey-2026-01-02-KA-1')
  })
  it('the same lock on another day is a second record: levels differ, and both are worth keeping', () => {
    const later = surveyEntry({ ...draft, observed: { at: '2026-12-01T09:00:00Z' } })
    expect(withSurveyEntries([surveyEntry(draft)], [later])).toHaveLength(2)
  })
  it('the same lock on the same day replaces itself', () => {
    const fixed = surveyEntry({ ...draft, carry: 'gravel' })
    const all = withSurveyEntries([surveyEntry(draft)], [fixed])
    expect(all).toHaveLength(1)
    expect(all[0].notes).toContain('Carry: gravel')
  })
})

describe('a surveyed carry on a route', () => {
  // Heading east along a line. Out of the channel on the left, over a strip of
  // land to a channel the route doesn't follow, back in on the right, a little
  // behind where they got out: nothing about the line can work that out.
  const line: LatLng[] = [[51.4, -1.11], [51.4, -1.09]]
  const c = { id: 's', name: SURVEY_NAME, at: [51.4, -1.1], licence: 'CC0-1.0', createdAt: '', updatedAt: '', landings: [[51.40005, -1.1], [51.4002, -1.10005]], seen: { banks: ['left', 'right'], headingDeg: 90 } } as PublicPortage

  it('keeps the landings exactly where they were recorded', () => {
    expect(portageOnRoute(line, c).takeOut.at).toEqual(c.landings[0])
    expect(portageOnRoute(line, c).putIn.at).toEqual(c.landings[1])
  })
  it('uses the banks that were seen, the way it was paddled', () => {
    const on = portageOnRoute(line, c)
    expect([on.takeOut.bank, on.putIn.bank]).toEqual(['left', 'right'])
  })
  it('the other way, the landings swap and each bank flips', () => {
    const on = portageOnRoute([...line].reverse(), c)
    expect(on.takeOut.at).toEqual(c.landings[1])
    expect([on.takeOut.bank, on.putIn.bank]).toEqual(['left', 'right'])
  })
  it('writes the heading it was paddled and the banks into the record', () => {
    expect(surveyEntry(draft).seen).toEqual({ banks: ['left', 'left'], headingDeg: 90 })
    expect(surveyEntry(draft).landings).toEqual(draft.landings)
  })
})

describe('surveys beside paddlers\' contributions', () => {
  const stored = (id: string, hidden?: boolean) => ({ id, hidden } as PublicPortage)
  it('adds them', () => expect(mergeSurvey([stored('a')], [stored('s')]).map(p => p.id)).toEqual(['a', 's']))
  it('a hidden survey stays hidden', () => {
    expect(mergeSurvey([stored('s', true)], [stored('s')])).toEqual([{ id: 's', hidden: true }])
  })
  it('a correction to the file reaches Plan, even after one was flagged', () => {
    const corrected = { id: 's', notes: 'new' } as PublicPortage
    expect(mergeSurvey([{ id: 's', notes: 'old' } as PublicPortage], [corrected])).toEqual([corrected])
  })
})

describe('what a survey changes about the stops', () => {
  const lock = { id: 'crt:locks:KA-014-004', kind: 'lock', name: 'Lock 98, Ufton Lock', at: [51.413353, -1.113277] } as never
  const [ufton] = withSurveyFeatures([lock])

  it('a lock you paddle through keeps its stop, says so, and isn\'t a portage', () => {
    expect(ufton).toMatchObject({ kind: 'lock', noCarry: true, name: expect.stringContaining('no carry unless the river is very high') })
  })
  it('adds the low bridges nobody lists, as portages', () => {
    const added = withSurveyFeatures([]).filter(f => f.kind === 'portage')
    expect(added.map(f => f.name)).toEqual(['Low bridge near Padworth', 'Low bridge near Sulhamstead'])
  })
  it('on the route: Ufton isn\'t counted, and the two bridges are', () => {
    const ds = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8')) as RegionDataset
    const r = routePlan({ ...ds, features: withSurveyFeatures(ds.features) }, { start: [51.3999, -1.1357], finish: [51.4647, -0.9847], shape: 'one_way' })
    if (typeof r === 'string') throw new Error(r)
    const portages = r.stops.filter(s => s.portage).map(s => s.feature.name)
    expect(r.stops.find(s => s.feature.id === 'crt:locks:KA-014-004')?.portage).toBe(false)
    expect(portages).toContain('Low bridge near Padworth')
    expect(portages).toContain('Low bridge near Sulhamstead')
  })
})

describe('what may be published', () => {
  it('nothing a person has not finished checking', () => {
    expect(uncheckedDrafts([draft])).toEqual([])
    expect(uncheckedDrafts([{ ...draft, putIn: '' }])).toHaveLength(1)
    expect(uncheckedDrafts([{ ...draft, sides: ['', 'left'] }])).toHaveLength(1)
    expect(uncheckedDrafts([{ ...draft, putIn: '', skip: true }])).toEqual([])
  })
})

describe('the committed surveys', () => {
  const ds = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8')) as RegionDataset

  it('name no person, are CC0, and say what the river was doing', () => {
    expect(surveyPortages.length).toBeGreaterThanOrEqual(10)
    for (const p of surveyPortages) {
      expect(p).toMatchObject({ name: SURVEY_NAME, licence: 'CC0-1.0' })
      expect(p.id).toMatch(/^[\w-]{1,64}$/)
      expect(p).not.toHaveProperty('userId')
      expect(p.notes!.length).toBeLessThanOrEqual(500)
    }
  })

  it.each(['portage-survey.json', 'survey-features.json'])('%s has no time of day: the repo is public, and times at each lock are a timeline of a paddle', file => {
    const text = fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data', file), 'utf8')
    const stamps = text.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g) ?? []
    expect(stamps.length).toBeGreaterThan(0)
    expect(stamps.filter(t => !t.endsWith('T12:00:00.000Z'))).toEqual([])
  })

  it('keeps the day and the level, which is what a landing depends on', () => {
    const g = surveyGauge(surveyPortages[0].id)!
    expect(g.valueM).toBeGreaterThan(0)
    expect(g.readAt.slice(0, 10)).toBe('2026-11-08')
  })

  it('each belongs to a lock on the DW route, with landings beside it', () => {
    const locks = new Map(withSurveyFeatures(ds.features).filter(f => f.kind === 'lock' || f.kind === 'portage').map(f => [f.id, f]))
    for (const p of surveyPortages) {
      const lock = locks.get(p.featureId!)!
      expect(lock, p.id).toBeTruthy()
      for (const l of p.landings) expect(haversine(l, lock.at), p.id).toBeLessThanOrEqual(150)
    }
  })

  // What the video showed, 8 Nov 2026, looking downstream: a wrong bank sends someone to the wrong side.
  it('Blakes Lock: the put-in is on the north channel, across the strip of land, about 20 m from the take-out', () => {
    const blakes = surveyPortages.find(p => p.featureId === 'ea-lock:blakes-river-kennet')!
    expect(blakes.landings[1][0]).toBeGreaterThan(blakes.landings[0][0])
    expect(haversine(blakes.landings[0], blakes.landings[1])).toBeGreaterThan(15)
  })

  it.each([
    ['KA-016-001', 'left', 'left'], ['KA-015-002', 'left', 'left'], ['KA-013-009', 'right', 'right'], ['KA-011-002', 'right', 'right'],
    ['KA-010-001', 'right', 'right'], ['KA-009-002', 'right', 'right'], ['KA-007-003', 'left', 'left'], ['KA-005-004', 'right', 'right'],
    ['KA-004-002', 'right', 'left'], // Fobney: out beside the lock, back in on the far bank of the weir stream
    ['KA-001-010', 'right', 'right'],
    ['blakes-river-kennet', 'left', 'right'], // out of the south channel, over the strip of land, back into the north one
    ['low-bridge-padworth', 'right', 'right'], ['low-bridge-sulhamstead', 'right', 'right'],
  ])('%s: Plan puts the take-out on the %s and the put-in on the %s, going downstream', (id, out, back) => {
    const r = routePlan(ds, { start: [51.3999, -1.1357], finish: [51.4647, -0.9847], shape: 'one_way' })
    if (typeof r === 'string') throw new Error(r)
    const onRoute = portageOnRoute(r.line, surveyPortages.find(p => p.featureId!.endsWith(id))!)
    expect([onRoute.takeOut.bank, onRoute.putIn.bank]).toEqual([out, back])
    // Coming the other way, the same two landings swap roles and banks.
    const upstream = portageOnRoute([...r.line].reverse(), surveyPortages.find(p => p.featureId!.endsWith(id))!)
    const flip = (b: string) => (b === 'left' ? 'right' : 'left')
    expect([upstream.takeOut.bank, upstream.putIn.bank]).toEqual([flip(back), flip(out)])
  })
})
