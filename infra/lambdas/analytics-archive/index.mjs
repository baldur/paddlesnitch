// Firehose transform for the analytics archive (docs/features/observability.md
// § Archive). The server Lambda's log group is subscribed to Firehose; each
// record is a gzipped CloudWatch Logs batch. Keep every analytics event (an
// EMF line from emitMetric with an `Event` name) as one JSON object per line;
// drop everything else. The archive is kept indefinitely and can't be erased,
// so this is the second line of defence after the track route: only known
// fields, paths cleaned as publicPath cleans them (lines logged before the
// route cleaned paths come through the backfill), no error message text, and
// the time to the minute. A record that can't be read, or that would take the
// answer past Lambda's 6 MB, is failed so Firehose keeps it under errors/.
// The server logs in Lambda's text format (`time\trequestId\tINFO\t{json}`); a
// switch to JSON logging would need eventFromLine changed. Plain JS.
import { gunzipSync } from 'node:zlib'

/** Every field an archived event may keep (the track route's rules, plus what
 *  the server sets). analytics-archive.test.ts checks it covers them. */
export const KEEP = new Set([
  'Event', 'sid', 'path', 'platform', 'appVersion', 'build',
  'campaign', 'repeat',                       // campaign events
  'type', 'signature', 'frames', 'crashedVersion', 'crashedBuild', 'os', // crash reports and page errors (never the message)
  'mode', 'course', 'end', 'secs', 'place', 'swims', 'knocked', 'bumps', 'km', 'from',
  'body', 'hair', 'hat', 'beard', 'aid', 'glasses', 'sleeves', 'boat', 'paddle', 'shape',
  'plays', 'places', 'input', 'gpu',          // game events
])

const PADDLES_STATIC = new Set(['new', 'compare', 'shared', 'api', 'section', 'sections'])
const PLAN_STATIC = new Set(['data', 'gaps', 'print', 'shared', 'sources'])
/** packages/ui/src/metrics-events.ts publicPath, for lines logged before the
 *  route applied it to every path. Keep the two in step (the test compares). */
export function cleanPath(path) {
  if (typeof path !== 'string') return undefined
  if (path.startsWith('app:')) return /^app:[a-z0-9_-]{1,40}$/.test(path) ? path : undefined
  if (!path.startsWith('/') || path.startsWith('//')) return undefined
  const p = path.split(/[?#]/)[0].slice(0, 200).split('/')
  const [, a, b] = p
  const from = (i) => { for (let k = i; k < p.length; k++) if (p[k]) p[k] = '[id]' }
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

// Every value must look like a word, number, code or list of them: no @, no
// sentences. The track route checks each field already; this also covers the
// older lines the backfill reads, logged before it did.
const SID = /^[A-Za-z0-9._-]{1,64}$/
const VALUE = /^[A-Za-z0-9_.,:|$<>()\/[\]-]{1,200}$/
const looksSafe = (k, v) => k === 'sid' ? SID.test(v) : k === 'os' ? /^[A-Za-z0-9 ._-]{1,40}$/.test(v) : VALUE.test(v)

/** One log line → the event it carries, or null. The JSON starts at the first `{`. */
export function eventFromLine(message) {
  const at = message.indexOf('{')
  if (at < 0) return null
  let o
  try { o = JSON.parse(message.slice(at)) } catch { return null }
  if (!o || typeof o !== 'object' || typeof o.Event !== 'string' || !o._aws || typeof o._aws.Timestamp !== 'number') return null
  const out = {}
  for (const [k, v] of Object.entries(o)) if (KEEP.has(k) && typeof v === 'string' && looksSafe(k, v)) out[k] = v
  if ('path' in o) { const p = cleanPath(o.path); if (p) out.path = p; else delete out.path }
  // A result on a public leaderboard (name, course, time) could be matched to
  // this event; without the tab id that match names nothing else.
  if (o.Event === 'game_play') delete out.sid
  // To the hour: close enough for use over time, too coarse to line a page
  // view up with a public result or entry made the same minute.
  out.ts = Math.floor(o._aws.Timestamp / 3600000) * 3600000
  return out
}

// A Lambda answer is at most 6 MB; leave room for the envelope.
const BUDGET = 5.5 * 1024 * 1024

export async function handler(event) {
  let used = 0
  return {
    records: event.records.map(({ recordId, data }) => {
      let batch
      try { batch = JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8')) } catch {
        return { recordId, result: 'ProcessingFailed', data }
      }
      const lines = batch.messageType === 'DATA_MESSAGE'
        ? (batch.logEvents ?? []).map((e) => eventFromLine(e.message)).filter(Boolean).map((e) => JSON.stringify(e) + '\n')
        : []
      if (!lines.length) return { recordId, result: 'Dropped', data: '' }
      const out = Buffer.from(lines.join(''), 'utf8').toString('base64')
      if (used + out.length > BUDGET) { used += data.length; return { recordId, result: 'ProcessingFailed', data } }
      used += out.length
      return { recordId, result: 'Ok', data: out }
    }),
  }
}
