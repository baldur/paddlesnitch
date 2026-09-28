// Every section names itself in the browser tab. Most pages used to show
// "ATTS — Automated Time Trials System" whatever they were.
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/font/google', () => ({ IBM_Plex_Mono: () => ({ className: '' }) }))
import { metadata as root } from '@/app/layout'
import { metadata as trials } from '@/app/att/layout'
import { metadata as paddles } from '@/app/paddles/layout'
import { metadata as profile } from '@/app/profile/layout'
import { metadata as privacy } from '@/app/att/privacy/page'

describe('page titles', () => {
  it('the site adds its name to every page title', () => {
    expect(root.title).toEqual({ default: 'paddlesnitch', template: '%s · paddlesnitch' })
  })
  it.each([
    ['Trials', trials.title],
    ['Paddles', paddles.title],
    ['Profile', profile.title],
    ['Privacy policy', privacy.title],
  ])('%s names itself', (expected, title) => {
    expect(title).toBe(expected)
  })
  it('nothing is still titled ATTS', () => {
    for (const m of [root, trials, paddles, profile, privacy]) expect(JSON.stringify(m)).not.toMatch(/ATTS/)
  })
})

describe('no AI model name on screen', () => {
  it('the paddle view and the section race page never print "narrated by <model>"', async () => {
    const { readFileSync } = await import('fs')
    for (const f of ['src/components/analysis/AnalysisView.tsx', 'src/app/paddles/compare/section/page.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/narrated by/)
    }
  })
})
