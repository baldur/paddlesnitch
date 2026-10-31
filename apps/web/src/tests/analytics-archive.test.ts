// The analytics archive's Firehose transform (infra/lambdas/analytics-archive):
// server log lines in, one clean JSON event per line out, every analytics
// event and nothing else (docs/features/observability.md § Archive).
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'zlib'
import * as archive from '../../../../infra/lambdas/analytics-archive/index.mjs'

// The transform is plain JS; give it the types the tests rely on.
const eventFromLine = archive.eventFromLine as unknown as (line: string) => Record<string, unknown> | null
const handler = archive.handler
import { buildEmf } from '@/lib/metrics'

const line = (o: unknown) => `2026-10-31T18:00:00.000Z\tabc-123\tINFO\t${JSON.stringify(o)}\n`
const emf = buildEmf('game_play', { sid: 'tab1', path: '/games/reading-thames/', mode: 'outing', secs: '312', platform: 'web' }, 1793469600000)

describe('eventFromLine', () => {
  it('keeps an analytics event: its fields and its time to the hour, without the metric wrapper', () => {
    expect(eventFromLine(line(buildEmf('game_kit', { sid: 'tab1', path: '/games/reading-thames/', body: 'slim', platform: 'web' }, 1793469612345)))).toEqual({
      Event: 'game_kit', sid: 'tab1', path: '/games/reading-thames/', body: 'slim', platform: 'web', ts: 1793469600000 - (1793469600000 % 3600000),
    })
  })

  it("keeps a game result without its tab id, so it can't be matched to a name on the public leaderboard and then to a whole visit", () => {
    const e = eventFromLine(line(buildEmf('game_play', { sid: 'tab1', mode: 'race', course: 'loop', secs: '1802', place: '3' }, 1793469612345)))
    expect(e).not.toHaveProperty('sid')
    expect(e).toMatchObject({ Event: 'game_play', course: 'loop', secs: '1802' })
  })

  it('keeps a value only if it looks like a word, number or code: an older line with free text loses that field', () => {
    const e = eventFromLine(line(buildEmf('pageview', { sid: 'pat@example.com', campaign: 'Hello Pat, your code is 1234!', path: '/att', type: 'x' }, 1)))
    expect(e).toEqual({ Event: 'pageview', path: '/att', type: 'x', ts: 0 })
  })

  it("cleans a path logged before the server cleaned them (the backfill reads 90 days of those)", () => {
    for (const [raw, want] of [
      ['/buddies/3f2a9c1e-7b4d/k3j4', '/buddies/[id]/[id]'],
      ['/plan/shared/Xy12abC_9', '/plan/shared/[id]'],
      ['/att/entries/e1?x=1', '/att/entries/[id]'],
      ['/att/trials/abc123', '/att/trials/abc123'],
      ['app:paddles', 'app:paddles'],
    ]) expect(eventFromLine(line(buildEmf('pageview', { path: raw })))?.path, raw).toBe(want)
    expect(eventFromLine(line(buildEmf('pageview', { path: 'mailto:a@b.c' }))) ?? {}).not.toHaveProperty('path')
  })

  it('keeps only known fields: no error message text, no stray props, no prop posing as the time', () => {
    const e = eventFromLine(line({ ...buildEmf('client_error', { message: 'Unexpected token in pat@example.com', type: 'SyntaxError', path: '/att', note: 'x' }, 1793469600000), ts: 1 }))
    expect(e).toEqual({ Event: 'client_error', type: 'SyntaxError', path: '/att', ts: 1793469600000 })
  })

  it('knows every field the server lets through', async () => {
    const { GAME_EVENT_PROPS } = await import('@paddlesnitch/ui/metrics-events')
    const { KEEP } = await import('../../../../infra/lambdas/analytics-archive/index.mjs')
    for (const rules of Object.values(GAME_EVENT_PROPS)) for (const k of Object.keys(rules)) expect(KEEP.has(k), k).toBe(true)
    for (const k of ['campaign', 'repeat', 'sid', 'path', 'platform', 'appVersion', 'build', 'type', 'signature', 'frames', 'crashedVersion', 'crashedBuild', 'os']) expect(KEEP.has(k), k).toBe(true)
  })

  it('reads a bare JSON line too (no Lambda prefix)', () => {
    expect(eventFromLine(JSON.stringify(emf))?.Event).toBe('game_play')
  })

  it('skips everything that is not an analytics event', () => {
    for (const l of [
      'START RequestId: abc Version: $LATEST',
      line({ kind: 'api_call', procedure: 'me', ms: 12 }),                // telemetry, not an Event
      line({ message: 'mentions "Event": in text' }),
      '2026-10-31T18:00:00.000Z\tabc\tERROR\tSomething broke { not json',
      line({ Event: 42 }),                                                  // not a name
    ]) expect(eventFromLine(l), l).toBeNull()
  })
})

const record = (id: string, payload: unknown) => ({ recordId: id, data: gzipSync(JSON.stringify(payload)).toString('base64') })
const decode = (r: { data?: string }) => Buffer.from(r.data ?? '', 'base64').toString('utf8')

describe('the Firehose transform', () => {
  it('turns a batch of log lines into one event per line, and drops batches with none', async () => {
    const out = await handler({ records: [
      record('a', { messageType: 'DATA_MESSAGE', logEvents: [
        { id: '1', timestamp: 1, message: line(emf) },
        { id: '2', timestamp: 2, message: 'END RequestId: abc' },
        { id: '3', timestamp: 3, message: line(buildEmf('pageview', { sid: 'tab2', path: '/paddles' }, 1793469601000)) },
      ] }),
      record('b', { messageType: 'DATA_MESSAGE', logEvents: [{ id: '4', timestamp: 4, message: 'REPORT RequestId: abc' }] }),
      record('c', { messageType: 'CONTROL_MESSAGE', logEvents: [] }),
    ] })
    expect(out.records.map((r: { recordId: string; result: string }) => [r.recordId, r.result])).toEqual([['a', 'Ok'], ['b', 'Dropped'], ['c', 'Dropped']])
    const lines = decode(out.records[0]).split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(lines.map(l => l.Event)).toEqual(['game_play', 'pageview'])
    expect(decode(out.records[0]).endsWith('\n')).toBe(true)
  })

  it('stays under the 6 MB a Lambda may answer: records past the budget fail (kept under errors/) rather than the whole call', async () => {
    const big = Array.from({ length: 4000 }, (_, i) => ({ id: String(i), timestamp: i, message: line(buildEmf('pageview', { path: '/att/' + 'x'.repeat(150), campaign: 'c' })) }))
    const records = Array.from({ length: 12 }, (_, i) => record(String(i), { messageType: 'DATA_MESSAGE', logEvents: big }))
    const out = await handler({ records })
    const size = out.records.reduce((n: number, r: { data?: string }) => n + (r.data?.length ?? 0), 0)
    expect(size).toBeLessThan(5.5 * 1024 * 1024)
    expect(out.records.some((r: { result: string }) => r.result === 'ProcessingFailed')).toBe(true)
    expect(out.records.map((r: { recordId: string }) => r.recordId)).toEqual(records.map(r => r.recordId))
  })

  it('fails a record it cannot read, so Firehose keeps it in the errors folder rather than losing it', async () => {
    const out = await handler({ records: [{ recordId: 'x', data: Buffer.from('not gzip').toString('base64') }] })
    expect(out.records[0].result).toBe('ProcessingFailed')
  })
})
