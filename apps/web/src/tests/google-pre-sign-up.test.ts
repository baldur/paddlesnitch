// The Cognito PreSignUp trigger (#697): one account per email. Our sign-ins
// find people by email, so two accounts sharing one could put someone into
// the other's account (security review). A Google sign-up whose email already
// has an account is refused (owner: link Google only from Account), and so is
// an email or Strava sign-up whose email belongs to a Google account. Google
// accounts must bring an email Google has verified.
import { describe, it, expect, vi, afterEach } from 'vitest'
// The trigger's own copy of the SDK (infra/node_modules), so the spy is on the client it uses.
import { CognitoIdentityProviderClient } from '../../../../infra/node_modules/@aws-sdk/client-cognito-identity-provider'
import { check as handler, handler as lambdaEntry } from '../../../../infra/lambdas/cognito-auth/pre-sign-up.mjs'

const event = (triggerSource: string, email = 'pat@example.com', verified = 'true') =>
  ({ triggerSource, userPoolId: 'pool', request: { userAttributes: { email, email_verified: verified } }, response: {} })
// Accounts as ListUsers returns them; email_verified true unless said otherwise.
const withUsers = (users: { UserStatus: string; verified?: boolean }[]) => ({
  usersWithEmail: async () => users.map(u => ({ UserStatus: u.UserStatus, Attributes: [{ Name: 'email_verified', Value: u.verified === false ? 'false' : 'true' }] })) as never[],
})
const GOOGLE = 'PreSignUp_ExternalProvider'

describe('PreSignUp: one account per email', () => {
  it('an account that set this email without proving it blocks nobody (#713)', async () => {
    for (const source of [GOOGLE, 'PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']) {
      expect(await handler(event(source), withUsers([{ UserStatus: 'CONFIRMED', verified: false }]))).toMatchObject({ triggerSource: source })
    }
  })

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

  it('a second Google identity with the same email is refused too (PreSignUp runs only for new users)', async () => {
    await expect(handler(event(GOOGLE), withUsers([{ UserStatus: 'EXTERNAL_PROVIDER' }]))).rejects.toThrow('ACCOUNT_EXISTS')
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

  // Production, 2026-10-26: Lambda passes its context as the second argument,
  // which had replaced our lookup and failed every Google sign-up.
  describe('as Lambda calls it: handler(event, context)', () => {
    afterEach(() => vi.restoreAllMocks())
    const lambdaHandler = lambdaEntry as unknown as (event: unknown, context: unknown) => Promise<unknown>
    const lambdaContext = { functionName: 'att-cognito-pre-sign-up', awsRequestId: 'r', getRemainingTimeInMillis: () => 5000 }
    const users = (list: { UserStatus: string }[]) =>
      vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockImplementation((async () => ({ Users: list.map(u => ({ ...u, Attributes: [{ Name: 'email_verified', Value: 'true' }] })) })) as never)

    it('looks the email up itself and lets a new one through', async () => {
      const spy = users([])
      expect(await lambdaHandler(event(GOOGLE), lambdaContext)).toMatchObject({ triggerSource: GOOGLE })
      expect(spy).toHaveBeenCalledOnce()
      const input = (spy.mock.calls[0][0] as unknown as { input: { UserPoolId: string; Filter: string } }).input
      expect(input.UserPoolId).toBe('pool')
      expect(input.Filter).toBe('email = "pat@example.com"')
    })

    it('still refuses an email that has an account', async () => {
      users([{ UserStatus: 'CONFIRMED' }])
      await expect(lambdaHandler(event(GOOGLE), lambdaContext)).rejects.toThrow('ACCOUNT_EXISTS')
    })
  })
})
