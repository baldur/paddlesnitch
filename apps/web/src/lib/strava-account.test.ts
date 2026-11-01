import { describe, it, expect } from 'vitest'
import {
  syntheticEmailFor,
  isSyntheticStravaEmail,
  athleteIdFromSyntheticEmail,
  stravaDisconnectRules,
} from './strava-account'

describe('syntheticEmailFor', () => {
  it('produces a stable address keyed off the athlete id', () => {
    expect(syntheticEmailFor(5158589)).toBe('strava-5158589@noreply.paddlesnitch.com')
  })

  it('round-trips through athleteIdFromSyntheticEmail', () => {
    const email = syntheticEmailFor(42)
    expect(athleteIdFromSyntheticEmail(email)).toBe(42)
  })
})

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

describe('athleteIdFromSyntheticEmail', () => {
  it('returns null for a real email', () => {
    expect(athleteIdFromSyntheticEmail('alice@example.com')).toBeNull()
  })

  it('returns null for nullish input', () => {
    expect(athleteIdFromSyntheticEmail(undefined)).toBeNull()
    expect(athleteIdFromSyntheticEmail(null)).toBeNull()
  })
})

// #712: what Account → Strava offers, by kind of account.
describe('stravaDisconnectRules', () => {
  const made = syntheticEmailFor(42)
  it('an account made with Sign in with Strava is told so, and keeps its only way in while Strava is off', () => {
    expect(stravaDisconnectRules(made, true)).toEqual({ canDisconnect: true, stravaOnly: true })
    expect(stravaDisconnectRules(made, false)).toEqual({ canDisconnect: false, stravaOnly: true })
  })
  it('an email account can always disconnect', () => {
    expect(stravaDisconnectRules('alice@example.com', true)).toEqual({ canDisconnect: true, stravaOnly: false })
    expect(stravaDisconnectRules('alice@example.com', false)).toEqual({ canDisconnect: true, stravaOnly: false })
  })
})
