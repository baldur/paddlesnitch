// @vitest-environment node
// The daily visit counts (infra/lambdas/visit-counts, #906): the archive keeps
// only counts of visits a day, with anything seen fewer than 5 times grouped
// as "other", so no visit can be picked out and joined to a page view's sid.
import { describe, it, expect } from 'vitest'
import * as counts from '../../../../infra/lambdas/visit-counts/counts.mjs'

type Row = Record<string, string>
const { MIN, QUERIES, dayWindow, toRows } = counts
const foldPlaces = counts.foldPlaces as (rows: Row[]) => Row[]
const foldSources = counts.foldSources as (rows: Row[]) => Row[]
const foldCampaigns = counts.foldCampaigns as (rows: Row[]) => Row[]
const buildCounts = counts.buildCounts as (day: string, rows: { places: Row[]; sources: Row[]; campaigns: Row[] }) => Record<string, unknown>

describe('folding: anything seen fewer than 5 times is "other"', () => {
  it('keeps a city seen 5 or more times, and groups the rest as "other" in their country', () => {
    expect(MIN).toBe(5)
    expect(foldPlaces([
      { country: 'GB', city: 'Reading', n: '12' },
      { country: 'GB', city: 'Henley-on-Thames', n: '5' },
      { country: 'GB', city: 'Marlow', n: '3' },
      { country: 'GB', city: 'Bristol', n: '1' },
      { country: 'GB', n: '2' },                       // no city known
    ])).toEqual([
      { country: 'GB', city: 'Reading', visits: 12 },
      { country: 'GB', city: 'other', visits: 6 },
      { country: 'GB', city: 'Henley-on-Thames', visits: 5 },
    ])
  })

  it('groups a rare country as "other", city and all, even when one city in it has every visit', () => {
    expect(foldPlaces([
      { country: 'GB', city: 'Reading', n: '9' },
      { country: 'IS', city: 'Reykjavík', n: '4' },
      { country: 'NZ', city: 'Auckland', n: '1' },
    ])).toEqual([
      { country: 'GB', city: 'Reading', visits: 9 },
      { country: 'other', city: 'other', visits: 5 },
    ])
  })

  it('treats anything that does not look like a country or place name as "other"', () => {
    const out = foldPlaces([{ country: 'GB', city: 'RG1 8AA', n: '7' }, { country: 'GBR', city: 'Reading', n: '6' }])
    expect(out).toEqual([{ country: 'GB', city: 'other', visits: 7 }, { country: 'other', city: 'other', visits: 6 }])
  })

  it('keeps sources seen 5 or more times, "(direct)" for none, and the rest as "other"', () => {
    expect(foldSources([
      { n: '20' }, { ref: 'google.com', n: '8' }, { ref: 'forum.example.org', n: '2' },
      { ref: 'https://bing.com/search?q=pat', n: '6' }, { ref: 'duckduckgo.com', n: '1' },
    ])).toEqual([
      { ref: '(direct)', visits: 20 }, { ref: 'other', visits: 9 }, { ref: 'google.com', visits: 8 },
    ])
  })

  it('keeps a campaign seen 5 or more times and groups the rest', () => {
    expect(foldCampaigns([
      { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'spring', n: '7' },
      { utm_source: 'club', utm_campaign: 'regatta', n: '5' },
      { utm_source: 'pat', utm_medium: 'sms', utm_campaign: 'x', n: '1' },
    ])).toEqual([
      { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'spring', visits: 7 },
      { utm_source: 'club', utm_medium: '', utm_campaign: 'regatta', visits: 5 },
      { utm_source: 'other', utm_medium: 'other', utm_campaign: 'other', visits: 1 },
    ])
  })
})

describe('the counts file', () => {
  const rows = {
    places: [
      { country: 'GB', city: 'Reading', n: '6' }, { country: 'NZ', city: 'Auckland', n: '1' },
      { country: 'GB', city: 'Reading', sid: 'tab1', path: '/att', n: '0' } as Row,
    ],
    sources: [{ ref: 'google.com', n: '5', sid: 'tab1', '@timestamp': '2026-11-07 10:00:00.000' } as Row, { n: '2' }],
    campaigns: [],
  }

  it('has the day, the minimum, the total and the three tables, and nothing else', () => {
    expect(buildCounts('2026-11-07', rows)).toEqual({
      day: '2026-11-07', min: 5, visits: 7,
      places: [{ country: 'GB', city: 'Reading', visits: 6 }, { country: 'other', city: 'other', visits: 1 }],
      sources: [{ ref: 'google.com', visits: 5 }, { ref: 'other', visits: 2 }],
      campaigns: [],
    })
  })

  it('never writes a sid, path, time, region or any per-visit row', () => {
    const text = JSON.stringify(buildCounts('2026-11-07', rows))
    for (const s of ['sid', 'tab1', 'path', '/att', 'timestamp', '10:00', 'region', 'nation', 'platform']) expect(text).not.toContain(s)
    for (const cell of (buildCounts('2026-11-07', rows).places as Row[])) expect(Object.keys(cell).sort()).toEqual(['city', 'country', 'visits'])
  })

  it('only counts in Logs Insights: every query ends in stats, never lists visit lines', () => {
    for (const q of Object.values(QUERIES) as string[]) {
      expect(q).toMatch(/^filter Event = "visit"/)
      expect(q).toMatch(/\| stats count\(\*\) as n by /)
      expect(q).not.toMatch(/fields|sid|@message/)
    }
  })
})

describe('the day and the file it writes', () => {
  it('counts yesterday (UTC) by default, as one whole day', () => {
    const w = dayWindow(Date.parse('2026-11-08T00:30:00Z'))
    expect(w).toEqual({ day: '2026-11-07', startTime: Date.parse('2026-11-07T00:00:00Z') / 1000, endTime: Date.parse('2026-11-08T00:00:00Z') / 1000 - 1, key: 'visits/2026/11/07.json' })
  })

  it('takes a day to rerun, and writes the same key again (a rerun overwrites)', () => {
    expect(dayWindow(Date.now(), '2026-11-07').key).toBe('visits/2026/11/07.json')
    expect(() => dayWindow(Date.now(), '7 Nov')).toThrow()
  })

  it('reads Logs Insights results into rows', () => {
    expect(toRows([[{ field: 'country', value: 'GB' }, { field: 'n', value: '3' }]])).toEqual([{ country: 'GB', n: '3' }])
  })
})
