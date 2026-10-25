// The daily error digest (docs/features/observability.md): what to ask Logs
// Insights about the last day, and how to turn the answers into one email.
// Pure, with no AWS SDK, so the tests import it directly; index.mjs runs the
// queries and sends the email.

const DAY = 24 * 3600

// `days`: how far back the query looks. Every section covers the last day,
// except "new app versions", which looks back 14 days to tell new from known.
export const QUERIES = [
  {
    key: 'errorsLogged',
    title: 'Errors the server logged',
    days: 1,
    query: [
      'filter @message like /\\tERROR\\t|Task timed out/',
      'parse @message /\\tERROR\\t(?<msg>.{0,140})/',
      'stats count(*) as n, latest(@timestamp) as last by coalesce(msg, substr(@message, 0, 140)) as what',
      'sort n desc',
      'limit 15',
    ].join('\n| '),
  },
  {
    key: 'apiErrors',
    title: 'API calls that failed on our side',
    days: 1,
    query: [
      'filter kind = "api_call" and ServerErrors > 0',
      'stats count(*) as n, latest(@timestamp) as last by path, code, platform',
      'sort n desc',
      'limit 15',
    ].join('\n| '),
  },
  {
    key: 'actionFailures',
    title: 'Key actions that failed',
    days: 1,
    query: [
      'filter kind = "action" and outcome = "fail"',
      'stats count(*) as n, latest(@timestamp) as last by Action, reason, platform',
      'sort n desc',
      'limit 15',
    ].join('\n| '),
  },
  {
    key: 'appCrashes',
    title: 'App crashes',
    days: 1,
    query: [
      'filter Event = "crash_report"',
      'stats count(*) as n, latest(@timestamp) as last by platform, crashedVersion, signature',
      'sort n desc',
      'limit 15',
    ].join('\n| '),
  },
  {
    key: 'browserErrors',
    title: 'Browser errors from our own scripts',
    days: 1,
    query: [
      'filter Event = "client_error"',
      'stats count(*) as n, latest(@timestamp) as last by message, path',
      'sort n desc',
      'limit 15',
    ].join('\n| '),
  },
  {
    key: 'activity',
    title: 'Activity',
    days: 1,
    query: [
      'filter kind = "api_call" or kind = "action"',
      'stats count(*) as n by kind',
    ].join('\n| '),
  },
  {
    key: 'appVersions',
    title: 'New app versions',
    days: 14,
    query: [
      'filter (platform = "android" or platform = "ios") and ispresent(appVersion)',
      'stats min(@timestamp) as first, count(*) as n by platform, appVersion',
      'sort first desc',
      'limit 20',
    ].join('\n| '),
  },
]

export const ERROR_SECTIONS = ['errorsLogged', 'apiErrors', 'actionFailures', 'appCrashes', 'browserErrors']

/** The query window for one entry of QUERIES, in epoch seconds. */
export function windowFor(q, nowMs) {
  const end = Math.floor(nowMs / 1000)
  return { startTime: end - q.days * DAY, endTime: end }
}

/** Logs Insights rows ([{ field, value }]) to plain objects. */
export function toRows(results) {
  return (results ?? []).map(row => Object.fromEntries(row.filter(c => !c.field.startsWith('@ptr')).map(c => [c.field, c.value])))
}

// Logs Insights timestamps are "2026-10-25 06:58:12.123" (UTC).
const parseTs = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z')
const n = (row) => Number(row.n ?? 0)
const line = (row, fields) => {
  const what = fields.map(f => row[f]).filter(v => v !== undefined && v !== '').join(' · ')
  return `  ${String(n(row)).padStart(4)} × ${what}${row.last ? `  (last ${String(row.last).slice(11, 16)} UTC)` : ''}`
}
const FIELDS = {
  errorsLogged: ['what'],
  apiErrors: ['path', 'code', 'platform'],
  actionFailures: ['Action', 'reason', 'platform'],
  appCrashes: ['platform', 'crashedVersion', 'signature'],
  browserErrors: ['message', 'path'],
}

/**
 * One email from the answers: `{ subject, text }`. `results` maps each query
 * key to its rows. A day with no errors still sends a short all-clear, so a
 * missing email means the digest broke, never "everything was fine".
 */
export function buildDigest(results, { nowMs, date = new Date(nowMs).toISOString().slice(0, 10) }) {
  const total = Object.fromEntries(ERROR_SECTIONS.map(k => [k, (results[k] ?? []).reduce((a, r) => a + n(r), 0)]))
  const errors = ERROR_SECTIONS.reduce((a, k) => a + total[k], 0)
  const activity = Object.fromEntries((results.activity ?? []).map(r => [r.kind, n(r)]))
  const newVersions = (results.appVersions ?? []).filter(r => nowMs - parseTs(r.first) <= DAY * 1000)

  const out = []
  out.push(errors === 0
    ? `All clear: no errors in the 24 hours to ${new Date(nowMs).toISOString().slice(11, 16)} UTC.`
    : `${errors} error${errors === 1 ? '' : 's'} in the 24 hours to ${new Date(nowMs).toISOString().slice(11, 16)} UTC.`)
  out.push(`Activity: ${activity.api_call ?? 0} API calls, ${activity.action ?? 0} key actions.`)

  for (const q of QUERIES) {
    if (!ERROR_SECTIONS.includes(q.key) || total[q.key] === 0) continue
    out.push('', `${q.title} (${total[q.key]})`)
    for (const row of results[q.key]) out.push(line(row, FIELDS[q.key]))
  }
  if (newVersions.length) {
    out.push('', 'New app versions seen for the first time')
    for (const r of newVersions) out.push(`  ${r.platform} ${r.appVersion} (${n(r)} request${n(r) === 1 ? '' : 's'})`)
  }
  out.push('', 'Dashboards: paddlesnitch-health (start here), paddlesnitch-api.')

  const subject = errors === 0
    ? `paddlesnitch ${date}: all clear`
    : `paddlesnitch ${date}: ${errors} error${errors === 1 ? '' : 's'}`
  return { subject, text: out.join('\n') }
}
