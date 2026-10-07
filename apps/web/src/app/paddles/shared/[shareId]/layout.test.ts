import { describe, it, expect, vi } from 'vitest'

vi.mock('@paddlesnitch/analysis/analysis-store', () => ({
  getSharedSession: async (id: string) => (id === 'good'
    ? { paddledAt: '2026-09-13T08:11:30Z', note: 'private words', result: { distanceKm: 4.218 } }
    : null),
}))

import { generateMetadata } from './layout'

describe('a shared paddle\'s title', () => {
  it('says what it is: distance and date', async () => {
    const m = await generateMetadata({ params: Promise.resolve({ shareId: 'good' }) })
    expect(m.title).toBe('4.2 km paddle on 13 Sep 2026')
    expect(JSON.stringify(m)).not.toContain('private words')
  })
  it('is plain for a missing or stopped link', async () => {
    expect((await generateMetadata({ params: Promise.resolve({ shareId: 'gone' }) })).title).toBe('A shared paddle')
  })
})
