// Shared wording for values the site shows: one way to write a date, a
// course's sport and a trial's entry rule, so pages stop printing raw stored
// values ('2025-04-12', 'BOTH', 'INVITATIONAL'). Pure and client-safe.
//
// Dates are written in UTC with a fixed locale, so a server-rendered page and
// the browser agree (a trial date is a calendar day, stored as YYYY-MM-DD).

// Month names spelled here, not by Intl: ICU versions differ ('Sep' or
// 'Sept'), and the server and the browser can carry different ones.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2025-04-12' or an ISO timestamp → '12 Apr 2025'. Unparseable → as given. */
export function fmtDay(value: string): string {
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (!Number.isFinite(t)) return value
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** An ISO timestamp → 'Sun, 13 Sep 2026'. Unparseable → as given. */
export function fmtWeekday(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  return `${WEEKDAYS[new Date(t).getUTCDay()]}, ${fmtDay(value)}`
}

/** An ISO timestamp → 'Sep 2026'. Unparseable → as given. */
export function fmtMonth(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  const d = new Date(t)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
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
