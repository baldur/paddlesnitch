// Source health (packages/waterways/src/health.ts): a source that fails or
// shrinks falls back to its last good copy instead of dropping out of the
// published data, and one failing three runs in a row is flagged.
import { describe, expect, it } from 'vitest'
import { assess, failing, healthLines, type SourceHealth } from '@paddlesnitch/waterways/health'

const now = '2026-10-18T02:17:00Z'
const ok: SourceHealth = { status: 'ok', features: 1000, lastOk: '2026-10-11T02:17:00Z', failures: 0 }

describe('source health', () => {
  it('accepts a fresh copy and resets the failure count', () => {
    expect(assess({ features: 980 }, { ...ok, status: 'stale', failures: 2 }, 1000, now))
      .toEqual({ use: 'fresh', health: { status: 'ok', features: 980, lastOk: now, failures: 0 } })
  })

  it('accepts the first ever copy of a source', () => {
    expect(assess({ features: 12 }, undefined, null, now).use).toBe('fresh')
  })

  it('falls back to the staged copy when a source errors', () => {
    expect(assess({ error: '503 https://x' }, ok, 1000, now))
      .toEqual({ use: 'staged', health: { status: 'stale', features: 1000, lastOk: ok.lastOk, failures: 1, error: '503 https://x' } })
  })

  it('treats a copy that shrank by more than half, or came back empty, as a failure', () => {
    const shrunk = assess({ features: 400 }, ok, 1000, now)
    expect(shrunk.use).toBe('staged')
    expect(shrunk.health.error).toBe('only 400 features; the last good copy had 1000')
    expect(assess({ features: 0 }, undefined, null, now).health).toMatchObject({ status: 'missing', error: 'no features' })
  })

  it('marks a source missing when it fails with nothing staged', () => {
    expect(assess({ error: 'timeout' }, undefined, null, now))
      .toEqual({ use: 'none', health: { status: 'missing', features: 0, lastOk: undefined, failures: 1, error: 'timeout' } })
  })

  it('flags sources that have failed three runs in a row', () => {
    let h: SourceHealth = ok
    for (let i = 0; i < 3; i++) h = assess({ error: 'gone' }, h, 1000, now).health
    const file = { checkedAt: now, sources: { sepa: h, crt: ok } }
    expect(failing(file)).toEqual(['sepa'])
    expect(healthLines(file)).toEqual([
      'sepa: STALE, using the copy from 2026-10-11 (1000 features); 3 run(s) failing: gone',
      'crt: ok, 1000 features',
    ])
  })
})
