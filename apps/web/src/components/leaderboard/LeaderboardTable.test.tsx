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
    expect(html).toContain('SUBMIT YOUR ENTRY')
    expect(html).toContain('Be the first to submit your entry.')
    expect(html).not.toContain('UPLOAD TRACE')
    expect(html).not.toContain('upload a trace')
  })

  it('shows the plain empty message and no CTA when no uploadHref is given', () => {
    const html = renderToStaticMarkup(<LeaderboardTable entries={[]} />)
    expect(html).toContain('No entries.')
    expect(html).not.toContain('SUBMIT YOUR ENTRY')
  })
})
