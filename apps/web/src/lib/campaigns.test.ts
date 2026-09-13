import { describe, it, expect } from 'vitest'
import { resolveCampaign } from './campaigns'

describe('resolveCampaign', () => {
  it('serves the default landing when no campaign is given', () => {
    expect(resolveCampaign(undefined)).toEqual({ requested: null, landing: 'default', found: false })
  })

  it('serves a known campaign landing', () => {
    expect(resolveCampaign('example1')).toEqual({ requested: 'example1', landing: 'example1', found: true })
  })

  it('falls back to the default landing for an unknown campaign, recording the miss', () => {
    // The "ffoooare" case from the feature request: unknown id → default, but
    // found=false so the caller can log that the campaign had no landing.
    expect(resolveCampaign('ffoooare')).toEqual({ requested: 'ffoooare', landing: 'default', found: false })
  })

  it('takes the first value when the param is repeated', () => {
    expect(resolveCampaign(['example1', 'other'])).toEqual({ requested: 'example1', landing: 'example1', found: true })
  })

  it('treats an empty param as no campaign', () => {
    expect(resolveCampaign('')).toEqual({ requested: null, landing: 'default', found: false })
  })
})
