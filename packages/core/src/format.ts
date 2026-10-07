// Shared wording for values the site shows: one way to write a date, a
// course's sport and a trial's entry rule, so pages stop printing raw stored
// values ('2025-04-12', 'BOTH', 'INVITATIONAL'). Pure and client-safe.
//
// Dates are written in UTC with a fixed locale, so a server-rendered page and
// the browser agree (a trial date is a calendar day, stored as YYYY-MM-DD).

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** '2025-04-12' or an ISO timestamp → '12 Apr 2025'. Unparseable → as given. */
export function fmtDay(value: string): string {
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
  return Number.isFinite(t) ? DAY.format(t) : value
}

/** A course's sport for a label: 'both' is meaningless on its own. */
export function sportLabel(sport: string): string {
  switch (sport) {
    case 'kayak': return 'KAYAK'
    case 'rowing': return 'ROWING'
    case 'both': return 'KAYAK AND ROWING'
    default: return sport.toUpperCase()
  }
}

/** Who may enter a trial, in words (the stored values are members / invitational / public). */
export function participationLabel(p: string): string {
  switch (p) {
    case 'members': return 'GROUP MEMBERS'
    case 'invitational': return 'INVITED ONLY'
    case 'public': return 'ANYONE'
    default: return p.toUpperCase()
  }
}
