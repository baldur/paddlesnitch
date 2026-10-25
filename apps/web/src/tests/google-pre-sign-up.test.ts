// The Cognito PreSignUp trigger for Sign in with Google (#697): a Google
// sign-up whose email already has an account is refused (the owner's decision:
// link Google only from Account); every other sign-up passes untouched.
import { describe, it, expect } from 'vitest'
import { handler } from '../../../../infra/lambdas/cognito-auth/pre-sign-up.mjs'

const event = (triggerSource: string, email = 'pat@example.com') =>
  ({ triggerSource, userPoolId: 'pool', request: { userAttributes: { email } }, response: {} })
const withUsers = (users: { UserStatus: string }[]) => ({ usersWithEmail: async () => users as never[] })

describe('PreSignUp', () => {
  it('lets email sign-ups and Strava\'s admin-created accounts through without looking anything up', async () => {
    const never = { usersWithEmail: async () => { throw new Error('looked up') } }
    for (const source of ['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']) {
      expect(await handler(event(source), never)).toMatchObject({ triggerSource: source })
    }
  })

  it('refuses a Google sign-up whose email already has an account', async () => {
    await expect(handler(event('PreSignUp_ExternalProvider'), withUsers([{ UserStatus: 'CONFIRMED' }]))).rejects.toThrow('ACCOUNT_EXISTS')
    await expect(handler(event('PreSignUp_ExternalProvider'), withUsers([{ UserStatus: 'FORCE_CHANGE_PASSWORD' }]))).rejects.toThrow('ACCOUNT_EXISTS')
  })

  it('lets a new email through, and a Google user\'s own repeat (only Google accounts with it)', async () => {
    expect(await handler(event('PreSignUp_ExternalProvider'), withUsers([]))).toBeTruthy()
    expect(await handler(event('PreSignUp_ExternalProvider'), withUsers([{ UserStatus: 'EXTERNAL_PROVIDER' }]))).toBeTruthy()
  })

  it('looks the email up as it will be stored, and refuses a Google account with none', async () => {
    let asked = ''
    await handler(event('PreSignUp_ExternalProvider', '  Pat@Example.COM '), { usersWithEmail: async (_p: string, e: string) => { asked = e; return [] } })
    expect(asked).toBe('pat@example.com')
    await expect(handler(event('PreSignUp_ExternalProvider', ''), withUsers([]))).rejects.toThrow('NO_EMAIL')
  })
})
