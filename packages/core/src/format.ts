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

/** An ISO timestamp → '13 Sep' (UTC, no year: for lists within a season). Unparseable → as given. */
export function fmtDayMonth(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * An ISO timestamp → '13 Sep 2026, 09:11' in the VIEWER's time zone: for when
 * a recording started, where the time of day matters. Browser-only pages
 * (the device pages fetch their data); a server-rendered page would print the
 * server's time zone and then disagree with the browser. Unparseable → as given.
 */
export function fmtDayTime(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** An ISO timestamp → '09:11' in the VIEWER's time zone (browser-only pages,
 *  like fmtDayTime): an arrival time on a plan's stop list. */
export function fmtTime(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** A wind direction in degrees (where it blows FROM) → one of 8 compass points: 22.4 → 'N', 22.6 → 'NE'. */
export function compassPoint(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

/** A course's sport for a label: 'both' is meaningless on its own. */
export function sportLabel(sport: string | undefined): string {
  switch (sport) {
    case 'kayak': return 'Kayak'
    case 'rowing': return 'Rowing'
    case 'both': return 'Kayak and rowing'
    // older courses may have no sport stored
    default: return sport ? sport.charAt(0).toUpperCase() + sport.slice(1) : ''
  }
}

/** Who may enter a trial, in words (the stored values are members / invitational / public). */
export function participationLabel(p: string): string {
  switch (p) {
    case 'members': return 'Group members'
    case 'invitational': return 'Invited only'
    case 'public': return 'Anyone'
    default: return p
  }
}
