// First-hand portage surveys: carries seen on the water and checked by a
// person, committed to data/portage-survey.json (CC0). Each one records the
// date and what the nearest gauge read, because a landing is only true at the
// level it was seen. Written by scripts/waterways/survey.ts; pure.
import { fmtDay } from '@paddlesnitch/core/format'
import data from '../data/portage-survey.json'
import featureData from '../data/survey-features.json'
import { cumulative } from './line'
import type { Feature, LatLng } from './types'
import { routeHeading, type PortageObserved, type PublicPortage } from './portage'

type SurveyRecord = PublicPortage & { observed?: PortageObserved }
const records = data as unknown as SurveyRecord[]

/** The surveys as CC0 records. The gauge reading is the Environment Agency's
 *  (OGL, which needs crediting), so it's kept out of them and out of the CC0
 *  dump, and added where a route is shown: see levelNote. */
export const surveyPortages: PublicPortage[] = records.map(({ observed, ...p }) => ({ ...p, ...(observed ? { observed: { at: observed.at } } : {}) }))

export const surveyGauge = (id: string): PortageObserved['gauge'] => records.find(p => p.id === id)?.observed?.gauge

const surveyedFeatures = featureData as unknown as { added: Feature[]; noCarry: { featureId: string; name: string }[] }

/** What a survey changes about the stops themselves: portages that aren't at a
 *  lock (low bridges nobody lists), and locks with nothing to carry round. */
export function withSurveyFeatures(features: Feature[]): Feature[] {
  const clear = new Map(surveyedFeatures.noCarry.map(n => [n.featureId, n.name]))
  return [...features.map(f => (clear.has(f.id) ? { ...f, name: clear.get(f.id), noCarry: true as const } : f)), ...surveyedFeatures.added]
}

/** Who a survey is credited to on Plan. Never a person's name: the file is public. */
export const SURVEY_NAME = 'paddlesnitch survey'

/** A gauge reading this far from the moment says nothing about it. */
const READING_NEAR_MS = 30 * 60_000

/** The reading closest to a moment, if one is close enough. */
export function readingAt<T extends { dateTime: string; value: number }>(readings: T[], iso: string): T | undefined {
  const t = Date.parse(iso)
  let best: T | undefined, gap = READING_NEAR_MS
  for (const r of readings) {
    const d = Math.abs(Date.parse(r.dateTime) - t)
    if (d <= gap) { best = r; gap = d }
  }
  return best
}

/** Beside paddlers' contributions. A stored copy of a survey only says whether
 *  it's hidden (flags and hides are written there): what it says comes from the
 *  committed file, so correcting a flagged survey reaches Plan. */
export function mergeSurvey(stored: PublicPortage[], survey: PublicPortage[] = surveyPortages): PublicPortage[] {
  const ids = new Set(survey.map(p => p.id))
  const hidden = new Map(stored.filter(p => ids.has(p.id)).map(p => [p.id, p.hidden]))
  return [...stored.filter(p => !ids.has(p.id)), ...survey.map(p => (hidden.get(p.id) ? { ...p, hidden: true } : p))]
}

// The words Conditions uses on the same screen (GAUGE_STATE_TEXT in plan-ui).
const STATE_WORDS = { low: 'below its usual range', normal: 'in its usual range', high: 'above its usual range' } as const
const GAUGE_OWNER = { ea: 'Environment Agency' } as const

export const seenNote = (at: string) => `Seen ${fmtDay(at)}.`

/** The reading, credited to the gauge's owner, for a route. Nothing for a record with no gauge. */
export function gaugeNote(g: NonNullable<PortageObserved['gauge']>): string {
  const state = g.state ? ` (${STATE_WORDS[g.state]})` : ''
  const flow = g.flowM3s === undefined ? '' : `, flow ${g.flowM3s.toFixed(1)} m³/s`
  return `${GAUGE_OWNER[g.source]} gauge at ${g.name} read ${g.valueM.toFixed(2)} m${state}${flow}.`
}

export function levelNote(id: string): string | undefined {
  const g = surveyGauge(id)
  return g && gaugeNote(g)
}

export type SurveyDraft = {
  featureId: string
  lock: string
  at: LatLng                    // the lock
  landings: [LatLng, LatLng]    // take-out, put-in
  line: LatLng[]                // the route past the lock, the way it was paddled
  sides: ['left' | 'right' | '', 'left' | 'right' | '']   // each landing's bank, looking the way it was paddled: from the footage
  observed: PortageObserved
  takeOut: string               // what's there, from the footage or the bank: filled in by a person
  putIn: string
  carry: string
  skip?: boolean                // checked, and not a real carry
}

/** The day only, as a timestamp. The file is public, and times to the second
 *  at each lock are a timeline of someone's paddle; the level needs only the day. */
export const dayOnly = (iso: string) => `${iso.slice(0, 10)}T12:00:00.000Z`

/** A checked draft as the record Plan shows. Same lock on the same day replaces itself. */
export function surveyEntry(d: SurveyDraft): PublicPortage {
  const at = dayOnly(d.observed.at)
  const observed: PortageObserved = { at, ...(d.observed.gauge ? { gauge: { ...d.observed.gauge, readAt: at } } : {}) }
  const notes = `Get out: ${d.takeOut}. Back in: ${d.putIn}. Carry: ${d.carry}. ${seenNote(d.observed.at)}`
  const slug = d.featureId.split(':').pop()!.replace(/[^\w-]/g, '-')
  return {
    id: `survey-${d.observed.at.slice(0, 10)}-${slug}`, name: SURVEY_NAME, featureId: d.featureId, at: d.at, notes,
    landings: d.landings,
    seen: { banks: d.sides as ['left' | 'right', 'left' | 'right'], headingDeg: Math.round(routeHeading(d.line, cumulative(d.line), d.landings[0])) },
    licence: 'CC0-1.0', observed, createdAt: at, updatedAt: at,
  }
}

/** The drafts a person hasn't finished checking: nothing unchecked is published. */
export const uncheckedDrafts = (drafts: SurveyDraft[]): SurveyDraft[] =>
  drafts.filter(d => !d.skip && (!d.takeOut || !d.putIn || !d.carry || !d.sides[0] || !d.sides[1]))

/** Add or replace entries, in a stable order so the file diffs cleanly. */
export function withSurveyEntries(all: PublicPortage[], entries: PublicPortage[]): PublicPortage[] {
  const byId = new Map(all.map(p => [p.id, p]))
  for (const e of entries) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}
