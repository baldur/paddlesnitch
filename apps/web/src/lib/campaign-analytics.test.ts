import { describe, it, expect } from 'vitest'
import { campaignFrom } from '@paddlesnitch/ui/metrics-events'

describe('campaignFrom (which campaign link a page view came from)', () => {
  it('reads ?campaign= from the query string', () => {
    expect(campaignFrom('?campaign=betatesters')).toBe('betatesters')
    expect(campaignFrom('?utm=x&campaign=betatesters')).toBe('betatesters')
  })
  it('is undefined when there is no campaign', () => {
    expect(campaignFrom('')).toBeUndefined()
    expect(campaignFrom('?next=/paddles')).toBeUndefined()
    expect(campaignFrom('?campaign=')).toBeUndefined()
  })
  it('keeps unknown ids (a mistyped link is worth seeing) but lower-cases them', () => {
    expect(campaignFrom('?campaign=BetaTesterz')).toBe('betatesterz')
  })
  it('refuses anything that is not a plain id, so the logs never carry junk', () => {
    expect(campaignFrom('?campaign=%3Cscript%3E')).toBeUndefined()
    expect(campaignFrom('?campaign=' + 'a'.repeat(41))).toBeUndefined()
  })
})
