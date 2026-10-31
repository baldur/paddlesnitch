// Shared analytics event vocabulary — the single source of truth for the STRICT
// allowlist. Pure (no React/DOM), so it's safe to import from the client capture
// (./analytics), the att server route + EMF helpers (apps/web/src/lib/metrics.ts
// re-exports these), and both apps. To add an event, add its name here, then
// call capture('your_event') anywhere in client code.
export type MetricEvent =
  | 'pageview'
  | 'signup'
  | 'login'
  | 'upload'
  | 'trial_create'
  | 'course_create'
  | 'campaign_cta'     // a campaign landing's main button (e.g. CLICK TO SNITCH)
  | 'campaign_signup'  // server: an application from a campaign landing was saved
  // Operational (docs/features/observability.md):
  | 'app_open'         // an app started (crash rate = crash_report ÷ app_open)
  | 'crash_report'     // an app crashed; sent on its next start
  | 'client_error'     // a browser error from our own scripts
  // The games (games/shared/analytics.js): what was played and chosen, never who.
  | 'game_play'        // one race, outing or drill
  | 'game_kit'         // the paddler when play starts, and after a change
  | 'game_session'     // time in the game since the last send, on hide/close

export const METRIC_EVENTS: readonly MetricEvent[] = [
  'pageview', 'signup', 'login', 'upload', 'trial_create', 'course_create',
  'campaign_cta', 'campaign_signup', 'app_open', 'crash_report', 'client_error',
  'game_play', 'game_kit', 'game_session',
]

// The game events' props: only these keys, each with its own rule, so nothing
// a player typed and no colour or skin tone reaches the logs. A key with a
// fixed set in the game takes only that set (a new option in the game is
// dropped here until it's added: lost data, never a leak); numbers must be
// numbers; the rest (ids the game picks from its own lists, never typed) are
// lower-case words. games/reading-thames/metrics.js sends them. At most 10 keys an
// event: the track route keeps 10 props.
const NUM = /^\d{1,7}(\.\d{1,2})?$/
const WORD = /^[a-z0-9][a-z0-9_-]{0,39}$/
const WORDS = /^[a-z0-9_-]{1,30}(,[a-z0-9_-]{1,30}){0,19}$/
const oneOf = (...v: string[]) => (x: string) => v.includes(x)
const someOf = (...v: string[]) => (x: string) => x.split(',').every(i => v.includes(i))
const test = (re: RegExp) => (x: string) => re.test(x)
type Rule = (v: string) => boolean
const FROM = oneOf('walk', 'menu')
export const GAME_EVENT_PROPS: Readonly<Record<'game_play' | 'game_kit' | 'game_session', Readonly<Record<string, Rule>>>> = {
  game_play: {
    mode: oneOf('race', 'trial', 'live', 'practice', 'drill', 'outing'), course: test(WORD),
    end: oneOf('finished', 'quit', 'restart', 'closed', 'ended'), secs: test(NUM), place: test(NUM), swims: test(NUM),
    knocked: test(NUM), bumps: test(NUM), km: test(NUM), from: FROM,
  },
  game_kit: {
    body: oneOf('broad', 'slim', 'curvy'), hair: oneOf('short', 'crop', 'ponytail', 'bun', 'long', 'none'),
    hat: oneOf('none', 'cap', 'visor', 'beanie'), beard: oneOf('none', 'stubble', 'moustache', 'beard'),
    aid: oneOf('true', 'false'), glasses: oneOf('none', 'wrap', 'round', 'aviator', 'square'),
    sleeves: oneOf('short', 'long'), boat: test(WORD), paddle: oneOf('wing', 'flat'), shape: test(WORD),
  },
  game_session: {
    secs: test(NUM), plays: test(NUM), from: FROM, places: test(WORDS),
    input: someOf('keys', 'mouse', 'pad', 'touch'), gpu: oneOf('webgpu', 'webgl2'),
  },
}

/** A game event's props with only its own keys and allowed values; other events' props as they came. */
export function gameEventProps(event: MetricEvent, props: unknown): unknown {
  const rules = (GAME_EVENT_PROPS as Record<string, Record<string, Rule>>)[event]
  if (!rules) return props
  if (!props || typeof props !== 'object') return undefined
  const p = props as Record<string, unknown>
  return Object.fromEntries(Object.entries(rules).flatMap(([k, ok]) => {
    const v = p[k]
    return typeof v === 'string' && ok(v) ? [[k, v]] : []
  }))
}

// Every other event a client may send, and the only props it may carry. The
// server's own events (login, signup, upload, campaign_signup, ...) are emitted
// directly, not through the track route; crash_report and client_error have
// their own fixed shapes (apps/web/src/lib/client-errors.ts). A prop not listed
// here is dropped, so nothing typed, no id and no field named like the
// event's own (Event, ts, _aws) gets into the logs or the archive.
const CAMPAIGN = test(/^[a-z0-9_-]{1,40}$/)
const CLIENT_EVENT_PROPS: Partial<Record<MetricEvent, Readonly<Record<string, Rule>>>> = {
  pageview: { campaign: CAMPAIGN },
  campaign_cta: { campaign: CAMPAIGN },
}

/** The props a client may send with this event: a game event's own rules, the
 *  short list above, or none. */
export function clientEventProps(event: MetricEvent, props: unknown): Record<string, string> {
  const rules = (GAME_EVENT_PROPS as Record<string, Record<string, Rule>>)[event] ?? CLIENT_EVENT_PROPS[event] ?? {}
  if (!props || typeof props !== 'object') return {}
  const p = props as Record<string, unknown>
  return Object.fromEntries(Object.entries(rules).flatMap(([k, ok]) => {
    const v = p[k]
    return typeof v === 'string' && ok(v) ? [[k, v]] : []
  }))
}

/** A client event's path as it may be recorded: an app screen (`app:paddles`),
 *  or a site page through publicPath; a game event only a page under /games. */
export function eventPath(event: MetricEvent, path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined
  if (event in GAME_EVENT_PROPS) return gamePath(event, path) as string | undefined
  if (path.startsWith('app:')) return /^app:[a-z0-9_-]{1,40}$/.test(path) ? path : undefined
  return path.startsWith('/') && !path.startsWith('//') ? publicPath(path.slice(0, 200)) : undefined
}

/** A game event's path: only a page under /games, else none. */
export const gamePath = (event: MetricEvent, path: unknown): unknown =>
  !(event in GAME_EVENT_PROPS) ? path : typeof path === 'string' && /^\/games(\/[a-z0-9_-]{1,40}){0,3}\/?$/.test(path) ? path : undefined

export function isMetricEvent(v: unknown): v is MetricEvent {
  return typeof v === 'string' && (METRIC_EVENTS as readonly string[]).includes(v)
}

// Which campaign link a page view came from: the `?campaign=` id, lower-cased,
// or undefined. Unknown ids are kept (a mistyped link is worth seeing on the
// dashboard); anything that isn't a short plain id is dropped so the logs never
// carry junk someone typed into the URL.
export function campaignFrom(search: string): string | undefined {
  const id = new URLSearchParams(search).get('campaign')?.trim().toLowerCase()
  return id && /^[a-z0-9_-]{1,40}$/.test(id) ? id : undefined
}

// A path as it may be recorded: analytics (kept for months) and feedback issues
// (a public GitHub repo). Segments that identify a person or are secrets become
// placeholders: a share id publishes a paddle's route, a claim code is live for
// minutes, a profile handle or tracker id says who someone is. Trial and course
// ids stay: they're public and are what the analytics are for.
const PADDLES_STATIC = new Set(['new', 'compare', 'shared', 'api', 'section', 'sections'])
const PLAN_STATIC = new Set(['data', 'gaps', 'print', 'shared', 'sources'])
/** Every page's path as it may be recorded; public-path.test.ts walks every
 *  dynamic page on disk and fails if a personal id survives. Only trial and
 *  course ids stay. Never a query string or fragment. */
export function publicPath(pathname: string): string {
  const p = pathname.split(/[?#]/)[0].split('/')
  const [, a, b] = p
  const from = (i: number) => { for (let k = i; k < p.length; k++) if (p[k]) p[k] = '[id]' }
  if (a === 'paddles' && b === 'shared' && p[3]) p[3] = '[id]'
  else if (a === 'paddles' && b && !PADDLES_STATIC.has(b)) p[2] = '[id]'
  else if (a === 'profile' && b === 'me' && p[3] === 'devices') from(4)
  else if (a === 'profile' && b && b !== 'me') p[2] = '[id]'
  else if (a === 'devices' || a === 'buddies') from(2)
  else if (a === 'plan' && b === 'shared') from(3)
  else if (a === 'plan' && b && !PLAN_STATIC.has(b)) p[2] = '[id]'
  else if (a === 'att' && (b === 'entries' || b === 'groups')) from(3)
  else if ((a === 'l' || a === 'L') && b) p[2] = '[code]'
  return p.join('/')
}
