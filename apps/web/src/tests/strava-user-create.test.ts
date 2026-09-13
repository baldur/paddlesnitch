// @vitest-environment node
// Integration test against the real cognito-local emulator (spawned by the
// vitest globalSetup). Exercises the ACTUAL adminCreateUserForStrava, not a
// mock — the callback test (strava-signin-callback.test.ts) mocks the whole
// cognito module, so it can't catch a regression inside this function.
import { describe, it, expect } from 'vitest'
import { adminCreateUserForStrava, findUserByEmail } from '@/lib/cognito'

// A Strava sign-in for a no-email athlete synthesises this address.
function synthEmail(): string {
  return `strava-${Date.now()}-${Math.floor(Math.random() * 1e6)}@noreply.paddlesnitch.com`
}

describe('adminCreateUserForStrava — self-healing on a leftover user', () => {
  it('creates the synth-email user on first call', async () => {
    const email = synthEmail()
    const res = await adminCreateUserForStrava(email, 'Bal G')
    expect('sub' in res).toBe(true)
    if ('sub' in res) expect(res.sub).toBeTruthy()
  })

  // The bug (#…): a prior attempt left a Cognito user with no athlete-index
  // link; on retry the fresh-creation path (which skips the by-email lookup
  // for synth addresses) called AdminCreateUser again, hit UsernameExists,
  // and dead-ended Strava sign-in on "Could not create an account" forever.
  // The create must now recover the existing user instead of erroring.
  it('returns the existing sub (not an error) when the user already exists', async () => {
    const email = synthEmail()
    const first = await adminCreateUserForStrava(email, 'Bal G')
    expect('sub' in first).toBe(true)

    // Second call with the same email = the retry after a half-finished attempt.
    const second = await adminCreateUserForStrava(email, 'Bal G')
    expect('error' in second).toBe(false)
    if ('sub' in first && 'sub' in second) {
      expect(second.sub).toBe(first.sub)
    }

    // And the recovered sub matches what a by-email lookup resolves — i.e. the
    // caller can (re)link the athlete index to a real, resolvable account.
    const looked = await findUserByEmail(email)
    expect(looked?.sub).toBe('sub' in first ? first.sub : undefined)
  })
})
