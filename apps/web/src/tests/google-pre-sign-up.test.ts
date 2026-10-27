// The Cognito PreSignUp trigger (#697): one account per email. Our sign-ins
// find people by email, so two accounts sharing one could put someone into
// the other's account (security review). A Google sign-up whose email already
// has an account is refused (owner: link Google only from Account), and so is
// an email or Strava sign-up whose email belongs to a Google account. Google
// accounts must bring an email Google has verified.
import { describe, it, expect, vi, afterEach } from 'vitest'
// The trigger's own copy of the SDK (infra/node_modules), so the spy is on the client it uses.
import { CognitoIdentityProviderClient } from '../../../../infra/node_modules/@aws-sdk/client-cognito-identity-provider'
import { check as handler, handler as lambdaEntry, linkKey } from '../../../../infra/lambdas/cognito-auth/pre-sign-up.mjs'

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

  // Connect Google (lib/google-link.ts): the one way a Google login joins an account.
  describe('Connect Google: a note from the signed-in account links instead of refusing', () => {
    const owner = { Username: 'u-1234', UserStatus: 'CONFIRMED', Attributes: [{ Name: 'email_verified', Value: 'true' }, { Name: 'sub', Value: 'sub-owner' }] }
    const googleEvent = { ...event(GOOGLE), userName: 'Google_10987654321' }
    const deps = (note: unknown, users: unknown[] = [owner]) => {
      const calls = { linked: [] as unknown[][], took: [] as string[] }
      return {
        calls,
        d: {
          usersWithEmail: async () => users as never[],
          takeLinkNote: async (email: string) => { calls.took.push(email); return note },
          linkGoogle: async (...a: unknown[]) => { calls.linked.push(a) },
        },
      }
    }
    const fresh = { userId: 'sub-owner', expiresAt: Date.now() + 60_000 }

    it('links the Google login to the account the note names, and stops the sign-up with LINKED', async () => {
      const { d, calls } = deps(fresh)
      await expect(handler(googleEvent, d)).rejects.toThrow('LINKED')
      expect(calls.linked).toEqual([['pool', 'u-1234', '10987654321']])
      expect(calls.took).toEqual(['pat@example.com'])
    })

    it('refuses as before with no note, a note for another account, or one that ran out', async () => {
      for (const note of [null, { ...fresh, userId: 'someone-else' }, { ...fresh, expiresAt: Date.now() - 1 }]) {
        const { d, calls } = deps(note)
        await expect(handler(googleEvent, d)).rejects.toThrow('ACCOUNT_EXISTS')
        expect(calls.linked).toEqual([])
      }
    })

    it('never links to another Google account, and never reads a note for an email sign-up', async () => {
      const g = deps(fresh, [{ ...owner, Username: 'Google_555' }])
      await expect(handler(googleEvent, g.d)).rejects.toThrow('ACCOUNT_EXISTS')
      expect(g.calls.linked).toEqual([])
      const e = deps(fresh)
      await expect(handler(event('PreSignUp_SignUp'), e.d)).rejects.toThrow('ACCOUNT_EXISTS')
      expect(e.calls.took).toEqual([])
    })

    it('reads the note where the website leaves it', async () => {
      const { linkNoteKey } = await import('@/lib/google-link')
      expect(linkKey(' Pat@Example.com ')).toBe(linkNoteKey('pat@example.com'))
    })
  })

  // The real note store and link command, as Lambda runs them (only the AWS
  // clients are faked: the trigger's own copies, in infra/node_modules).
  describe('Connect Google, as Lambda runs it', () => {
    const owner = { Username: 'u-1234', UserStatus: 'CONFIRMED', Attributes: [{ Name: 'email_verified', Value: 'true' }, { Name: 'sub', Value: 'sub-owner' }] }
    const googleEvent = { ...event(GOOGLE), userName: 'Google_10987654321' }
    const run = lambdaEntry as unknown as (e: unknown, c: unknown) => Promise<unknown>
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

    async function setup(store: Record<string, string>, s3Error?: string) {
      vi.stubEnv('DATA_BUCKET', 'data-bucket')
      const s3 = await import('../../../../infra/node_modules/@aws-sdk/client-s3')
      const s3calls: { name: string; input: { Bucket: string; Key: string } }[] = []
      vi.spyOn(s3.S3Client.prototype, 'send').mockImplementation((async (cmd: { constructor: { name: string }; input: { Bucket: string; Key: string } }) => {
        s3calls.push({ name: cmd.constructor.name, input: cmd.input })
        if (s3Error) throw Object.assign(new Error(s3Error), { name: s3Error })
        if (cmd.constructor.name === 'GetObjectCommand') {
          if (!(cmd.input.Key in store)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
          return { Body: { transformToString: async () => store[cmd.input.Key] } }
        }
        delete store[cmd.input.Key]
        return {}
      }) as never)
      const idp: { name: string; input: Record<string, unknown> }[] = []
      vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockImplementation((async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        idp.push({ name: cmd.constructor.name, input: cmd.input })
        return cmd.constructor.name === 'ListUsersCommand' ? { Users: [owner] } : {}
      }) as never)
      return { s3calls, idp }
    }

    it('reads the note, deletes it, and links with Cognito\'s real command; a second Google trip finds no note', async () => {
      const store: Record<string, string> = { [linkKey('pat@example.com')]: JSON.stringify({ userId: 'sub-owner', expiresAt: Date.now() + 60_000 }) }
      const { s3calls, idp } = await setup(store)
      await expect(run(googleEvent, {})).rejects.toThrow('LINKED')
      expect(s3calls.map(c => c.name)).toEqual(['GetObjectCommand', 'DeleteObjectCommand'])
      expect(s3calls.every(c => c.input.Bucket === 'data-bucket' && c.input.Key === linkKey('pat@example.com'))).toBe(true)
      expect(idp.find(c => c.name === 'AdminLinkProviderForUserCommand')?.input).toEqual({
        UserPoolId: 'pool',
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'u-1234' },
        SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: '10987654321' },
      })
      await expect(run(googleEvent, {})).rejects.toThrow('ACCOUNT_EXISTS')
    })

    it('no note, an S3 error or a broken note: refused as before, never linked', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      for (const [store, err] of [[{}, undefined], [{}, 'AccessDenied'], [{ [linkKey('pat@example.com')]: 'not json' }, undefined]] as const) {
        const { s3calls, idp } = await setup({ ...store }, err)
        await expect(run(googleEvent, {})).rejects.toThrow('ACCOUNT_EXISTS')
        expect(idp.some(c => c.name === 'AdminLinkProviderForUserCommand')).toBe(false)
        if (!err && !Object.keys(store).length) expect(s3calls.map(c => c.name)).toEqual(['GetObjectCommand'])
        vi.restoreAllMocks()
      }
    })

    it('two verified holders, an owner without a sub, or no Google id: never linked', async () => {
      const note = { userId: 'sub-owner', expiresAt: Date.now() + 60_000 }
      const took: string[] = []
      const d = (users: unknown[]) => ({ usersWithEmail: async () => users as never[], takeLinkNote: async (e: string) => { took.push(e); return note }, linkGoogle: async () => { throw new Error('must not link') } })
      await expect(handler(googleEvent, d([owner, { ...owner, Username: 'u-2' }]))).rejects.toThrow('ACCOUNT_EXISTS')
      expect(took).toEqual([])
      await expect(handler(googleEvent, d([{ ...owner, Attributes: [{ Name: 'email_verified', Value: 'true' }] }]))).rejects.toThrow('ACCOUNT_EXISTS')
      await expect(handler({ ...event(GOOGLE) }, d([owner]))).rejects.toThrow('ACCOUNT_EXISTS')
    })
  })
})
