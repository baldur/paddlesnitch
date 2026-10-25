// The Cognito PreSignUp trigger (#697): one account per email. Our sign-ins
// find people by email, so two accounts sharing one could put someone into
// the other's account (security review). A Google sign-up whose email already
// has an account is refused (owner: link Google only from Account), and so is
// an email or Strava sign-up whose email belongs to a Google account. Google
// accounts must bring an email Google has verified.
import { describe, it, expect } from 'vitest'
import { handler } from '../../../../infra/lambdas/cognito-auth/pre-sign-up.mjs'

const event = (triggerSource: string, email = 'pat@example.com', verified = 'true') =>
  ({ triggerSource, userPoolId: 'pool', request: { userAttributes: { email, email_verified: verified } }, response: {} })
const withUsers = (users: { UserStatus: string }[]) => ({ usersWithEmail: async () => users as never[] })
const GOOGLE = 'PreSignUp_ExternalProvider'

describe('PreSignUp: one account per email', () => {
  it('a new email passes every way in', async () => {
    for (const source of [GOOGLE, 'PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']) {
      expect(await handler(event(source), withUsers([]))).toMatchObject({ triggerSource: source })
    }
  })

  it('refuses a Google sign-up whose email already has an email or Strava account', async () => {
    for (const status of ['CONFIRMED', 'FORCE_CHANGE_PASSWORD']) {
      await expect(handler(event(GOOGLE), withUsers([{ UserStatus: status }]))).rejects.toThrow('ACCOUNT_EXISTS')
    }
  })

  it('refuses an email sign-up, or a Strava account, on an email a Google account has', async () => {
    for (const source of ['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']) {
      await expect(handler(event(source), withUsers([{ UserStatus: 'EXTERNAL_PROVIDER' }]))).rejects.toThrow('ACCOUNT_EXISTS')
    }
  })

  it('a Google user signing in again is not a second account', async () => {
    expect(await handler(event(GOOGLE), withUsers([{ UserStatus: 'EXTERNAL_PROVIDER' }]))).toBeTruthy()
  })

  it('half-made accounts (never confirmed) block nobody', async () => {
    expect(await handler(event(GOOGLE), withUsers([{ UserStatus: 'UNCONFIRMED' }]))).toBeTruthy()
    expect(await handler(event('PreSignUp_SignUp'), withUsers([{ UserStatus: 'UNCONFIRMED' }]))).toBeTruthy()
  })

  it('a Google account needs an email, verified by Google', async () => {
    await expect(handler(event(GOOGLE, ''), withUsers([]))).rejects.toThrow('NO_EMAIL')
    await expect(handler(event(GOOGLE, 'pat@example.com', 'false'), withUsers([]))).rejects.toThrow('EMAIL_UNVERIFIED')
  })

  it('looks the email up as it will be stored, and leaves other triggers alone', async () => {
    let asked = ''
    await handler(event(GOOGLE, '  Pat@Example.COM '), { usersWithEmail: async (_p: string, e: string) => { asked = e; return [] } })
    expect(asked).toBe('pat@example.com')
    const never = { usersWithEmail: async () => { throw new Error('looked up') } }
    expect(await handler(event('PreSignUp_SomethingElse'), never)).toBeTruthy()
  })
})
