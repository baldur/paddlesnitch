import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'

import LeaderboardTable from './LeaderboardTable'

// #122: the submission call-to-action was worded inconsistently across the app
// ("Upload entry" / "Upload a trace" / "UPLOAD TRACE"). The agreed wording is
// "Submit your entry". Lock the leaderboard empty-state CTA to that wording.
describe('LeaderboardTable empty state CTA (#122)', () => {
  it('uses the "submit your entry" wording, not "upload a trace"', () => {
    const html = renderToStaticMarkup(
      <LeaderboardTable entries={[]} uploadHref="/att/trials/abc/upload" />,
    )
    expect(html).toContain('Submit your entry')
    expect(html).toContain('Be the first to submit your entry.')
    expect(html).not.toContain('UPLOAD TRACE')
    expect(html).not.toContain('upload a trace')
  })

  it('shows the plain empty message and no CTA when no uploadHref is given', () => {
    const html = renderToStaticMarkup(<LeaderboardTable entries={[]} />)
    expect(html).toContain('No entries yet')
    expect(html).not.toContain('Submit your entry')
  })
})

// Design audit 2026-10: a COURSE RECORD mark on every class's fastest row (4 of
// 6 rows on a real trial) stopped meaning anything. The data still marks one
// record per class; the table shows only the fastest record holder in view.
describe('LeaderboardTable record mark', () => {
  const row = (entryId: string, boatClass: string, secs: number) => ({
    entryId, userId: `u-${entryId}`, displayName: `Paddler ${entryId}`, boatClass, totalElapsedSeconds: secs,
    splits: [], crew: [], submittedAt: '2026-10-01T10:00:00Z', raceDate: '2026-10-01',
  })
  it('marks only the fastest record holder, not every class record', () => {
    const entries = [row('a', 'K2', 200), row('b', 'K1', 230), row('c', 'K1', 240), row('d', '1X', 260)]
    const html = renderToStaticMarkup(
      // @ts-expect-error minimal leaderboard rows for the test
      <LeaderboardTable entries={entries} marks={{ a: 'COURSE RECORD', b: 'COURSE RECORD', d: 'COURSE RECORD', c: 'PB' }} />,
    )
    expect(html.match(/course record/gi)?.length).toBe(1)
    expect(html).toContain('K2 course record')
    expect(html).toContain('PB')
  })
})
