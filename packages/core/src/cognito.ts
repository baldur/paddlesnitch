import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  UserNotConfirmedException,
  CodeMismatchException,
  ExpiredCodeException,
  UsernameExistsException,
  NotAuthorizedException,
  UserNotFoundException,
  InvalidPasswordException,
} from '@aws-sdk/client-cognito-identity-provider'
import { randomBytes } from 'crypto'
import { JwtRsaVerifier } from 'aws-jwt-verify'
import { SimpleJwksCache } from 'aws-jwt-verify/jwk'
import type { AuthUser } from './types'

const REGION = process.env.COGNITO_REGION ?? 'eu-west-1'
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? ''
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? ''
const ENDPOINT = process.env.COGNITO_ENDPOINT

function makeClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: REGION,
    ...(ENDPOINT ? {
      endpoint: ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    } : {}),
  })
}

// Tiny fetcher that supports http:// (for cognito-local) AND https:// (for real Cognito).
// aws-jwt-verify's default fetcher rejects http://, so we wrap native fetch instead.
class HttpJwksFetcher {
  async fetch(uri: string): Promise<ArrayBuffer> {
    // Timed out: on a cold start every sign-in check waits on this fetch.
    const res = await fetch(uri, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`JWKS fetch failed (${res.status}) for ${uri}`)
    return res.arrayBuffer()
  }
}

// JWT verifier is lazily created (and cached) so tests can swap env vars.
// Uses generic JwtRsaVerifier so cognito-local's custom issuer (http://localhost:9229/<poolId>)
// works alongside real AWS Cognito (https://cognito-idp.<region>.amazonaws.com/<poolId>).
let _verifier: ReturnType<typeof JwtRsaVerifier.create> | null = null
function getVerifier() {
  if (_verifier) return _verifier
  const issuer = ENDPOINT
    ? `${ENDPOINT}/${USER_POOL_ID}`
    : `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`
  _verifier = JwtRsaVerifier.create(
    {
      issuer,
      audience: CLIENT_ID,
      jwksUri: `${issuer}/.well-known/jwks.json`,
    },
    { jwksCache: new SimpleJwksCache({ fetcher: new HttpJwksFetcher() }) }
  )
  return _verifier
}

export type TokenPair = {
  idToken: string
  refreshToken: string
}

export type CognitoError =
  | 'email_exists'
  | 'invalid_credentials'
  | 'invalid_password'
  | 'user_not_found'
  | 'invalid_code'
  | 'expired_code'
  | 'not_confirmed'
  | 'unknown'

function classify(err: unknown): CognitoError {
  if (err instanceof UsernameExistsException) return 'email_exists'
  // The PreSignUp trigger's "one account per email" refusal (#697).
  if ((err as { name?: string })?.name === 'UserLambdaValidationException' && /ACCOUNT_EXISTS/.test(String((err as Error).message))) return 'email_exists'
  if (err instanceof InvalidPasswordException) return 'invalid_password'
  if (err instanceof CodeMismatchException) return 'invalid_code'
  if (err instanceof ExpiredCodeException) return 'expired_code'
  // Cognito says this only once the password is right (#702).
  if (err instanceof UserNotConfirmedException) return 'not_confirmed'
  if (err instanceof NotAuthorizedException) return 'invalid_credentials'
  if (err instanceof UserNotFoundException) return 'invalid_credentials'
  return 'unknown'
}

// Creates a CONFIRMED account with email_verified=true, sending nothing. Only
// for paths that prove the address some other way (the email-code sign-in,
// seed data, tests). A person creating an account with a password goes through
// startSignUp + confirmSignUp, which prove the address with a code (#702).
export async function signUp(
  email: string,
  displayName: string,
  password: string
): Promise<{ sub: string } | { error: CognitoError }> {
  const client = makeClient()
  try {
    const res = await client.send(new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'name', Value: displayName },
      ],
    }))
    // Auto-confirm so the user can sign in immediately.
    await client.send(new AdminConfirmSignUpCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
    }))
    // Mark email as verified so Cognito's password-reset (and any future
    // OTP) flows accept the address as recoverable. Without this, account
    // recovery via email fails — Cognito requires email_verified=true.
    // Note: passing `email` alongside `email_verified` is required by
    // cognito-local (and harmless on real Cognito).
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }))
    return { sub: res.UserSub! }
  } catch (err) {
    return { error: classify(err) }
  }
}

// Email + password sign-up (#702): Cognito emails a code (autoVerify on the
// pool, Cognito's own sender) and the account can't sign in until
// confirmSignUp. An unconfirmed account already on this email proved nothing,
// so starting again replaces it (and sends a new code) instead of refusing.
export async function startSignUp(
  email: string,
  displayName: string,
  password: string,
): Promise<{ sub: string } | { error: CognitoError }> {
  const client = makeClient()
  const attempt = () => client.send(new SignUpCommand({
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'name', Value: displayName },
    ],
  }))
  try {
    return { sub: (await attempt()).UserSub! }
  } catch (err) {
    if (!(err instanceof UsernameExistsException)) return { error: classify(err) }
  }
  try {
    const existing = await client.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }))
    if (existing.UserStatus !== 'UNCONFIRMED') return { error: 'email_exists' }
    await client.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email }))
    return { sub: (await attempt()).UserSub! }
  } catch (err) {
    return { error: classify(err) }
  }
}

// The code from the sign-up email. Marks the email verified explicitly as well
// (real Cognito does it itself; cognito-local doesn't).
export async function confirmSignUp(email: string, code: string): Promise<{ ok: true } | { error: CognitoError }> {
  const client = makeClient()
  try {
    await client.send(new ConfirmSignUpCommand({ ClientId: CLIENT_ID, Username: email, ConfirmationCode: code }))
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }))
    return { ok: true }
  } catch (err) {
    return { error: classify(err) }
  }
}

// cognito-local answers operations it doesn't have with this; real Cognito
// never does. Local dev carries on as if the call worked.
const localOnlyUnsupported = (err: unknown) => (err as { name?: string })?.name === 'Unsupported'

// A new sign-up code, for someone whose password was right but who never
// entered the first one. cognito-local doesn't have it: there the first code
// still stands (tests stub it).
export async function resendSignUpCode(email: string): Promise<{ ok: true } | { error: CognitoError }> {
  try {
    await makeClient().send(new ResendConfirmationCodeCommand({ ClientId: CLIENT_ID, Username: email }))
    return { ok: true }
  } catch (err) {
    if (localOnlyUnsupported(err)) return { ok: true }
    return { error: classify(err) }
  }
}

// Ends every session the account has: all its refresh tokens stop working
// (#702: a password reset must end a squatter's sessions). ID tokens already
// issued stay valid until they expire (at most 24 h); hasRecentSignIn still
// refuses them for deleting or connecting Strava. Throws on failure: the
// caller decides. (Not in cognito-local, where it does nothing; tests stub it.)
export async function signOutEverywhere(email: string): Promise<void> {
  try {
    await makeClient().send(new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: email }))
  } catch (err) {
    if (!localOnlyUnsupported(err)) throw err
  }
}

export async function signIn(
  email: string,
  password: string
): Promise<TokenPair | { error: CognitoError }> {
  const client = makeClient()
  try {
    const res = await client.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }))
    const auth = res.AuthenticationResult
    if (!auth?.IdToken || !auth?.RefreshToken) {
      return { error: 'unknown' }
    }
    return { idToken: auth.IdToken, refreshToken: auth.RefreshToken }
  } catch (err) {
    return { error: classify(err) }
  }
}

export async function refresh(
  refreshToken: string
): Promise<{ idToken: string } | { error: CognitoError }> {
  const client = makeClient()
  try {
    const res = await client.send(new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }))
    const idToken = res.AuthenticationResult?.IdToken
    if (!idToken) return { error: 'invalid_credentials' }
    return { idToken }
  } catch (err) {
    return { error: classify(err) }
  }
}

// Triggers Cognito to email a password-reset code to the user.
// Returns `void` on success. We intentionally don't reveal whether the email
// exists to the caller — Cognito with `preventUserExistenceErrors` already
// avoids leaking that to clients, but we also return the same value either
// way at the API layer.
export async function forgotPassword(email: string): Promise<{ ok: true } | { error: CognitoError }> {
  const client = makeClient()
  try {
    await client.send(new ForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: email,
    }))
    return { ok: true }
  } catch (err) {
    return { error: classify(err) }
  }
}

// Confirms a password reset: user supplies the emailed code and a new
// password. Cognito validates the code and updates the password.
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ ok: true } | { error: CognitoError }> {
  const client = makeClient()
  try {
    await client.send(new ConfirmForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    }))
    return { ok: true }
  } catch (err) {
    return { error: classify(err) }
  }
}

// Starts the OTP flow. Cognito invokes our CreateAuthChallenge Lambda which
// generates the code, emails it, and returns a session token we use in
// the next step.
export async function otpRequest(
  email: string,
): Promise<{ session: string } | { error: CognitoError }> {
  const client = makeClient()
  try {
    const res = await client.send(new InitiateAuthCommand({
      AuthFlow: 'CUSTOM_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email },
    }))
    if (!res.Session) return { error: 'unknown' }
    return { session: res.Session }
  } catch (err) {
    return { error: classify(err) }
  }
}

// Completes the OTP flow. Returns ID + refresh tokens on success.
export async function otpVerify(
  email: string,
  session: string,
  code: string,
): Promise<TokenPair | { needsAnotherTry: true; session: string } | { error: CognitoError }> {
  const client = makeClient()
  try {
    const res = await client.send(new RespondToAuthChallengeCommand({
      ChallengeName: 'CUSTOM_CHALLENGE',
      ClientId: CLIENT_ID,
      Session: session,
      ChallengeResponses: { USERNAME: email, ANSWER: code },
    }))
    if (res.AuthenticationResult?.IdToken && res.AuthenticationResult?.RefreshToken) {
      return {
        idToken: res.AuthenticationResult.IdToken,
        refreshToken: res.AuthenticationResult.RefreshToken,
      }
    }
    // Cognito returned another challenge — the answer was wrong but the
    // user still has retries left. Hand back the new session so the client
    // can try again.
    if (res.Session) return { needsAnotherTry: true, session: res.Session }
    return { error: 'invalid_code' }
  } catch (err) {
    return { error: classify(err) }
  }
}

export async function revoke(refreshToken: string): Promise<void> {
  const client = makeClient()
  try {
    await client.send(new RevokeTokenCommand({
      ClientId: CLIENT_ID,
      Token: refreshToken,
    }))
  } catch {
    // Best effort — revocation failures shouldn't block logout.
  }
}

// Deletes the user from Cognito permanently. Used by the GDPR Art. 17
// erasure flow. Cognito identifies users by sign-in alias (email), not by sub.
// Already gone counts as done: an erasure whose answer was lost gets retried
// by the app, and the retry must succeed rather than report a failure.
export async function deleteUser(email: string): Promise<void> {
  const client = makeClient()
  try {
    await client.send(new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
    }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'UserNotFoundException') return
    throw err
  }
}

// Deletes the account whose sub this is, whatever its username: an email
// account's username is its email, a Google account's is "Google_<id>", so
// erasure finds the user by sub rather than by email. Already gone counts as
// done (a repeated erasure); any other error throws.
export async function deleteUserBySub(sub: string): Promise<void> {
  const client = makeClient()
  const res = await client.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: `sub = "${sub.replace(/"/g, '\\"')}"`,
    Limit: 1,
  }))
  const username = res.Users?.[0]?.Username
  if (!username) return
  try {
    await client.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'UserNotFoundException') return
    throw err
  }
}

type UserSummary = {
  sub: string; email: string; displayName: string
  /** Signs in with Google (username `Google_<id>`): our email-based sign-ins can't reach it. */
  google?: true
}

function userSummaryFromAttributes(user: { Username?: string; Attributes?: Array<{ Name?: string; Value?: string }> }): UserSummary {
  const attr = (name: string) => user.Attributes?.find(a => a.Name === name)?.Value ?? ''
  return {
    sub: attr('sub'),
    email: attr('email'),
    displayName: attr('name') || (attr('email').split('@')[0]),
    ...(user.Username?.startsWith('Google_') ? { google: true as const } : {}),
  }
}

// Look up an existing user by their verified email. Returns null when the
// email isn't present. Used by the Strava sign-in flow to auto-link a
// Strava login to a pre-existing email/password account.
export async function findUserByEmail(email: string): Promise<UserSummary | null> {
  const client = makeClient()
  // ListUsers with a filter expression is the supported way to search by
  // attribute. One account per email is the rule (PreSignUp, #697), but a
  // Google account's email can change on a later sign-in, so two accounts can
  // still share one: then nobody is returned rather than whichever comes first
  // (an invitation must never reach the wrong person). Half-made (UNCONFIRMED)
  // accounts can't be signed into and don't count.
  const res = await client.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: `email = "${email.replace(/"/g, '\\"')}"`,
    Limit: 10,
  }))
  // Nor do accounts whose email isn't verified: an address someone typed but
  // never proved must not receive another person's invitation (#702).
  const users = (res.Users ?? []).filter(u => u.UserStatus !== 'UNCONFIRMED'
    && u.Attributes?.find(a => a.Name === 'email_verified')?.Value === 'true')
  if (users.length > 1) {
    console.warn('[cognito] findUserByEmail: more than one account has this email; refusing to pick one')
    return null
  }
  if (!users[0]) return null
  return userSummaryFromAttributes(users[0])
}

// Look up a user by their Cognito sub. Used by the trial-invitation UI
// to enrich a list of invitedUserIds with friendly email + display name.
// Skips the Cognito round-trip entirely on the dev path if cognito-local
// doesn't support sub-filter; callers should treat null as "not found".
export async function findUserBySub(sub: string): Promise<UserSummary | null> {
  const client = makeClient()
  try {
    const res = await client.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${sub.replace(/"/g, '\\"')}"`,
      Limit: 1,
    }))
    const user = res.Users?.[0]
    if (!user) return null
    return userSummaryFromAttributes(user)
  } catch (err) {
    // cognito-local may not implement the `sub` filter; degrade gracefully
    // so the trial admin page can still render — names just go blank.
    console.warn('[cognito] findUserBySub failed', err)
    return null
  }
}

// Whether an account with this sub exists. Unlike findUserBySub it never
// answers "no" on an error: it throws. Use it where "no" leads to deleting
// something (scripts/strava-index-cleanup.ts).
export async function userExistsBySub(sub: string): Promise<boolean> {
  const res = await makeClient().send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: `sub = "${sub.replace(/"/g, '\\"')}"`,
    Limit: 1,
  }))
  if (res.Users?.length) return true
  // An exact sub filter never pages; an empty page with more to come isn't a "no".
  if (res.PaginationToken) throw new Error('userExistsBySub: unexpected pagination')
  return false
}

// Create a Cognito user for a Strava sign-in where no pre-existing account
// was found. We never want the user to see Cognito's invitation email
// (MessageAction=SUPPRESS) and we set a random permanent password they
// will never use — sign-in goes through CUSTOM_AUTH instead. Email is
// marked verified because Strava already verified it.
export async function adminCreateUserForStrava(
  email: string,
  displayName: string,
): Promise<{ sub: string } | { error: CognitoError }> {
  const client = makeClient()
  try {
    const res = await client.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: displayName },
      ],
    }))
    // Set a permanent, never-used password so the account isn't stuck in
    // FORCE_CHANGE_PASSWORD state (which would block CUSTOM_AUTH).
    const random = randomBytes(32).toString('base64') + 'A1!a'
    await client.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: random,
      Permanent: true,
    }))
    const sub = res.User?.Attributes?.find(a => a.Name === 'sub')?.Value
    if (!sub) return { error: 'unknown' }
    return { sub }
  } catch (err) {
    // Self-heal a half-created user. A prior sign-in attempt can leave a
    // Cognito user with no athlete-index link (created, then customAuthSignIn
    // or the index write failed). On retry, AdminCreateUser throws
    // UsernameExists and Strava sign-in dead-ends on "Could not create an
    // account from your Strava profile" — forever, because the account can
    // never be re-created. Recover: resolve the existing user, re-assert a
    // permanent password (so it isn't stuck in FORCE_CHANGE_PASSWORD, which
    // blocks CUSTOM_AUTH), and return its sub so the caller can (re)link and
    // sign in. This makes the create idempotent for the synth-email path,
    // which deliberately skips the by-email lookup upstream.
    if (err instanceof UsernameExistsException) {
      const existing = await findUserByEmail(email)
      if (existing) {
        const random = randomBytes(32).toString('base64') + 'A1!a'
        await client.send(new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          Password: random,
          Permanent: true,
        })).catch(() => {})
        return { sub: existing.sub }
      }
    }
    return { error: classify(err) }
  }
}

// Sign in via the Custom Auth flow, bypassing the password. The Strava
// sign-in callback uses this after it has verified the user's identity
// against Strava. The flow is:
//   1. InitiateAuth(CUSTOM_AUTH) with `presetToken` passed in
//      ClientMetadata.preset_otp. The CreateAuthChallenge Lambda reads it
//      and stores it as the expected answer.
//   2. RespondToAuthChallenge with the same token as the answer.
//   3. VerifyAuthChallenge confirms; tokens are issued.
// Only our server can do both halves, so only our server can trigger this
// sign-in path.
//
// `expectedSub`: the account the caller means. Cognito finds the user by email
// (an alias), so the tokens are checked to be that account's before they are
// handed out; on a mismatch they are revoked and nothing is returned
// (security review, #697: two accounts could once share an email).
export async function customAuthSignIn(
  email: string,
  presetToken: string,
  expectedSub?: string,
): Promise<TokenPair | { error: CognitoError }> {
  const client = makeClient()
  try {
    // Stash the one-time token on the user so CreateAuthChallenge can read it
    // from userAttributes. Cognito does NOT forward ClientMetadata to the
    // auth-challenge triggers, so the attribute is the only reliable channel.
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [{ Name: 'custom:auth_preset', Value: presetToken }],
    }))
    const init = await client.send(new InitiateAuthCommand({
      AuthFlow: 'CUSTOM_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email },
    }))
    if (!init.Session) return { error: 'unknown' }
    const resp = await client.send(new RespondToAuthChallengeCommand({
      ChallengeName: 'CUSTOM_CHALLENGE',
      ClientId: CLIENT_ID,
      Session: init.Session,
      ChallengeResponses: { USERNAME: email, ANSWER: presetToken },
    }))
    // Clear the one-time token regardless of outcome (best-effort) so it can't
    // be reused as the expected answer on a later attempt.
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [{ Name: 'custom:auth_preset', Value: '' }],
    })).catch(() => {})
    const auth = resp.AuthenticationResult
    if (!auth?.IdToken || !auth?.RefreshToken) return { error: 'unknown' }
    if (expectedSub !== undefined && (await verifyIdToken(auth.IdToken))?.id !== expectedSub) {
      await revoke(auth.RefreshToken)
      console.warn('[cognito] customAuthSignIn signed in a different account than asked; refused')
      return { error: 'unknown' }
    }
    return { idToken: auth.IdToken, refreshToken: auth.RefreshToken }
  } catch (err) {
    return { error: classify(err) }
  }
}

/** What a verified ID token says about the sign-in behind it. */
export type SignInClaims = {
  sub: string
  /** Unix seconds of the last real sign-in (`auth_time`, never `iat`). */
  signedInAt: number | null
  /** Stays the same across refreshes of one sign-in (`origin_jti`; `jti` where a test Cognito lacks it). */
  session: string | null
}

/** Pure: the sign-in facts from verified claims, or null if they aren't an ID token's. */
export function signInFromClaims(claims: Record<string, unknown>): SignInClaims | null {
  if (claims.token_use !== 'id' || typeof claims.sub !== 'string') return null
  const session = typeof claims.origin_jti === 'string' ? claims.origin_jti : typeof claims.jti === 'string' ? claims.jti : null
  return { sub: claims.sub, signedInAt: typeof claims.auth_time === 'number' ? claims.auth_time : null, session }
}

/**
 * The sign-in behind an ID token. Cognito keeps the original `auth_time` on a
 * refreshed token (the OpenID rule; cognito-local doesn't), so `signedInAt` is
 * the last time someone typed a password or code or went through Strava.
 */
export async function idTokenSignIn(idToken: string): Promise<SignInClaims | null> {
  try {
    return signInFromClaims(await getVerifier().verify(idToken) as Record<string, unknown>)
  } catch {
    return null
  }
}

/** Unverified: the session key of a token we were just handed by Cognito ourselves. */
export function sessionOfFreshToken(idToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString())
    return signInFromClaims({ ...claims, token_use: 'id' })?.session ?? null
  } catch {
    return null
  }
}

export async function verifyIdToken(idToken: string): Promise<AuthUser | null> {
  try {
    const claims = await getVerifier().verify(idToken)
    if (claims.token_use !== 'id') return null
    const email = typeof claims.email === 'string' ? claims.email : ''
    // Real Cognito sends `name` in the ID token when standard attributes are configured;
    // cognito-local does not. Fall back to email's local part so dev still has a name.
    const name = typeof claims.name === 'string' && claims.name
      ? claims.name
      : email.split('@')[0]
    return {
      id: String(claims.sub),
      email,
      displayName: name,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    }
  } catch {
    return null
  }
}
