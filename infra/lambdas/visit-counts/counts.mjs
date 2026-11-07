// Daily visit counts (#906, docs/features/observability.md § Where visitors
// come from). Pure: the queries, the day's window, and turning Logs Insights
// rows into the one counts file kept for good. No visit row, sid, path or time
// finer than the day is ever written; any place, source or campaign seen fewer
// than MIN times that day is grouped as "other", so a rare one can't be picked
// out and matched to a page view (which carries the sid and the country).
// Plain JS; index.mjs runs it.

export const MIN = 5
const OTHER = 'other'

export const QUERIES = {
  places: 'filter Event = "visit"\n| stats count(*) as n by country, city\n| limit 10000',
  sources: 'filter Event = "visit"\n| stats count(*) as n by ref\n| limit 10000',
  campaigns: 'filter Event = "visit" and (ispresent(utm_source) or ispresent(utm_medium) or ispresent(utm_campaign))\n| stats count(*) as n by utm_source, utm_medium, utm_campaign\n| limit 10000',
}

/** The UTC day to count: `day` ('YYYY-MM-DD') if given, else yesterday. Its
 *  window in epoch seconds, as StartQuery takes it, and the file's key. */
export function dayWindow(nowMs, day) {
  const start = day ? Date.parse(`${day}T00:00:00Z`) : Math.floor(nowMs / 86400000) * 86400000 - 86400000
  if (!Number.isFinite(start) || (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))) throw new Error(`not a day: ${day}`)
  const d = new Date(start).toISOString().slice(0, 10)
  return { day: d, startTime: start / 1000, endTime: start / 1000 + 86400 - 1, key: `visits/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}.json` }
}

/** Logs Insights results ([[{ field, value }]]) → plain rows. */
export const toRows = (results) => (results ?? []).map((r) => Object.fromEntries(r.map(({ field, value }) => [field, value])))

// The same shapes the track route lets through; anything else is "other".
const COUNTRY = /^[A-Z]{2}$/
const CITY = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,59}$/u
const REF = /^(?=.{1,100}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/
const UTM = /^[a-z0-9_.-]{1,40}$/
const ok = (re, v) => (typeof v === 'string' && re.test(v) ? v : undefined)
const n = (r) => { const x = Number(r.n); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0 }

/** Add `count` to the cell named by `keys` in `map`. */
function add(map, keys, count) {
  const k = JSON.stringify(keys)
  map.set(k, (map.get(k) ?? 0) + count)
}
const sorted = (map, names) => [...map].map(([k, visits]) => ({ ...Object.fromEntries(JSON.parse(k).map((v, i) => [names[i], v])), visits }))
  .sort((a, b) => b.visits - a.visits || JSON.stringify(a).localeCompare(JSON.stringify(b)))

/** Visits by country and town or city. A country seen fewer than MIN times
 *  becomes "other" (and its cities with it); a city seen fewer than MIN times
 *  becomes "other" within its country. */
export function foldPlaces(rows) {
  const byCountry = new Map()
  for (const r of rows) { const c = ok(COUNTRY, r.country) ?? OTHER; byCountry.set(c, (byCountry.get(c) ?? 0) + n(r)) }
  const out = new Map()
  for (const r of rows) {
    const count = n(r)
    if (!count) continue
    let country = ok(COUNTRY, r.country) ?? OTHER
    let city = ok(CITY, r.city) ?? OTHER
    if (country === OTHER || byCountry.get(country) < MIN) { country = OTHER; city = OTHER }
    else if (count < MIN) city = OTHER
    add(out, [country, city], count)
  }
  return sorted(out, ['country', 'city'])
}

/** Visits by referring site; none is "(direct)". Fewer than MIN is "other". */
export function foldSources(rows) {
  const out = new Map()
  for (const r of rows) {
    const count = n(r)
    if (!count) continue
    const ref = r.ref === undefined || r.ref === '' ? '(direct)' : ok(REF, r.ref) ?? OTHER
    add(out, [count < MIN ? OTHER : ref], count)
  }
  return sorted(out, ['ref'])
}

/** Visits by utm tags (only visits that had any). Fewer than MIN is "other". */
export function foldCampaigns(rows) {
  const out = new Map()
  for (const r of rows) {
    const count = n(r)
    if (!count) continue
    const tags = ['utm_source', 'utm_medium', 'utm_campaign'].map((k) => (r[k] === undefined ? '' : ok(UTM, r[k]) ?? OTHER))
    add(out, count < MIN || tags.includes(OTHER) ? [OTHER, OTHER, OTHER] : tags, count)
  }
  return sorted(out, ['utm_source', 'utm_medium', 'utm_campaign'])
}

/** The one file for a day: counts only. */
export function buildCounts(day, { places, sources, campaigns }) {
  const placeCells = foldPlaces(places)
  return {
    day,
    min: MIN,
    visits: placeCells.reduce((t, c) => t + c.visits, 0),
    places: placeCells,
    sources: foldSources(sources),
    campaigns: foldCampaigns(campaigns),
  }
}
