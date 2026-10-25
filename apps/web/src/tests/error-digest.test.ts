// The daily error digest (docs/features/observability.md): the queries it
// runs and the email it builds from their answers. The Logs Insights and SNS
// round trip was checked against production when it was written; what matters
// here is the email and the queries' shape.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import * as digest from '../../../../infra/lambdas/error-digest/digest.mjs'

type Row = Record<string, string>
const { QUERIES, ERROR_SECTIONS, windowFor, toRows, buildDigest } = digest as unknown as {
  QUERIES: { key: string; title: string; days: number; query: string }[]
  ERROR_SECTIONS: string[]
  windowFor: (q: { days: number }, nowMs: number) => { startTime: number; endTime: number }
  toRows: (results: { field: string; value: string }[][]) => Row[]
  buildDigest: (results: Record<string, Row[]>, opts: { nowMs: number }) => { subject: string; text: string }
}

const NOW = Date.parse('2026-10-25T07:00:00Z')
const quiet = { activity: [{ kind: 'api_call', n: '1520' }, { kind: 'action', n: '41' }] }

describe('the email', () => {
  it('a quiet day still sends a short all-clear, so silence never means "fine"', () => {
    const { subject, text } = buildDigest(quiet, { nowMs: NOW })
    expect(subject).toBe('paddlesnitch 2026-10-25: all clear')
    expect(text).toContain('All clear: no errors in the 24 hours to 07:00 UTC.')
    expect(text).toContain('Activity: 1520 API calls, 41 key actions.')
    for (const q of QUERIES.filter(q => ERROR_SECTIONS.includes(q.key))) expect(text).not.toContain(q.title)
  })

  it('counts every error in the subject and lists only the sections that had some', () => {
    const { subject, text } = buildDigest({
      ...quiet,
      apiErrors: [{ path: 'paddles.get', code: 'INTERNAL_SERVER_ERROR', platform: 'android', n: '3', last: '2026-10-25 06:41:02.123' }],
      actionFailures: [{ Action: 'upload', reason: 'http_500', platform: 'web', n: '1', last: '2026-10-24 22:10:00.000' }],
      appCrashes: [],
    }, { nowMs: NOW })
    expect(subject).toBe('paddlesnitch 2026-10-25: 4 errors')
    expect(text).toContain('API calls that failed on our side (3)')
    expect(text).toContain('     3 × paddles.get · INTERNAL_SERVER_ERROR · android  (last 06:41 UTC)')
    expect(text).toContain('Key actions that failed (1)')
    expect(text).not.toContain('App crashes')
  })

  it('one error is "1 error"', () => {
    expect(buildDigest({ ...quiet, browserErrors: [{ message: 'x is undefined', path: '/plan', n: '1' }] }, { nowMs: NOW }).subject)
      .toBe('paddlesnitch 2026-10-25: 1 error')
  })

  it('names app versions seen for the first time in the last day, not older ones', () => {
    const { text } = buildDigest({ ...quiet, appVersions: [
      { platform: 'android', appVersion: '1.1.0', first: '2026-10-25 03:00:00.000', n: '12' },
      { platform: 'ios', appVersion: '1.0.0', first: '2026-10-20 09:00:00.000', n: '300' },
    ] }, { nowMs: NOW })
    expect(text).toContain('android 1.1.0 (12 requests)')
    expect(text).not.toContain('ios 1.0.0')
  })
})

describe('the queries', () => {
  it('separate their commands with pipes, as Logs Insights needs', () => {
    for (const q of QUERIES) {
      const lines = q.query.split('\n')
      expect(lines.slice(1).every(l => l.startsWith('| '))).toBe(true)
    }
  })

  it('look back one day, except new app versions (14 days, to tell new from known)', () => {
    expect(QUERIES.filter(q => q.days !== 1).map(q => q.key)).toEqual(['appVersions'])
    expect(windowFor({ days: 1 }, NOW)).toEqual({ startTime: NOW / 1000 - 86400, endTime: NOW / 1000 })
  })

  it('turn Logs Insights rows into plain objects, without the internal pointer', () => {
    expect(toRows([[{ field: 'path', value: 'a' }, { field: 'n', value: '2' }, { field: '@ptr', value: 'x' }]])).toEqual([{ path: 'a', n: '2' }])
  })
})

describe('the infra', () => {
  const stack = readFileSync(path.join(__dirname, '../../../../infra/lib/att-stack.ts'), 'utf8')
  const block = stack.slice(stack.indexOf("new lambda.Function(this, 'ErrorDigestFn'"), stack.indexOf("alarm('ErrorDigestFailedAlarm'") + 500)

  it('runs every morning at 07:00 UTC and emails through the alerts topic', () => {
    expect(block).toContain("events.Schedule.cron({ minute: '0', hour: '7' })")
    expect(block).toContain('TOPIC_ARN: alerts.topicArn')
    expect(block).toContain('alerts.grantPublish(digestFn)')
  })

  it('may only start queries on the server log group', () => {
    expect(block).toContain("actions: ['logs:StartQuery'],")
    expect(block).toContain('log-group:/aws/lambda/${serverFn.functionName}:*')
  })

  it('a digest that failed raises its own alarm', () => {
    expect(block).toContain("alarmName: 'paddlesnitch-digest-failed'")
    expect(block).toContain('digestFn.metricErrors(')
  })
})
