import { describe, it, expect } from 'vitest'
import { isSyntheticStravaEmail } from './strava-account'

describe('isSyntheticStravaEmail', () => {
  it('recognises a synthesised address', () => {
    expect(isSyntheticStravaEmail('strava-1@noreply.paddlesnitch.com')).toBe(true)
  })

  it('is case-insensitive on the domain', () => {
    expect(isSyntheticStravaEmail('strava-1@NoReply.Paddlesnitch.com')).toBe(true)
  })

  it('rejects a real paddlesnitch.com address', () => {
    // Important: a user could legitimately have a real noreply@ inbox at
    // the apex. The synthetic check is scoped to the noreply subdomain.
    expect(isSyntheticStravaEmail('noreply@paddlesnitch.com')).toBe(false)
  })

  it('rejects malformed look-alikes', () => {
    expect(isSyntheticStravaEmail('strava-@noreply.paddlesnitch.com')).toBe(false)
    expect(isSyntheticStravaEmail('strava-abc@noreply.paddlesnitch.com')).toBe(false)
    expect(isSyntheticStravaEmail('strava-1@paddlesnitch.com')).toBe(false)
  })

  it('handles undefined / null / empty input', () => {
    expect(isSyntheticStravaEmail(undefined)).toBe(false)
    expect(isSyntheticStravaEmail(null)).toBe(false)
    expect(isSyntheticStravaEmail('')).toBe(false)
  })
})
