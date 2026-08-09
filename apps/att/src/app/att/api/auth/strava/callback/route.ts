import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { exchangeCode, getAthleteProfile } from '@/lib/strava'
import {
  putStravaTokens,
  getUserIdByAthleteId,
  putAthleteIndex,
} from '@/lib/strava-storage'
import {
  findUserByEmail,
  findUserBySub,
  adminCreateUserForStrava,
  customAuthSignIn,
  verifyIdToken,
} from '@/lib/cognito'
import { setAuthCookies } from '@/lib/auth'
import { canonicalBaseUrl } from '@/lib/url'
import { syntheticEmailFor } from '@/lib/strava-account'

// Strava OAuth callback for the SIGN-IN flow. This is what runs after the
// user approves the authorize page from /att/api/auth/strava/init.
//
// On success: the user has a Cognito session and is bounced to ?next= (or
// /att). The Strava tokens are also persisted so activity import works
// without a second authorize round-trip.
//
// On failure: bounced back to /att/auth with an ?error= the page maps to a
// friendly message.
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const params = req.nextUrl.searchParams
  const code = params.get('code')
  const stateFromStrava = params.get('state')
  const errorFromStrava = params.get('error')

  const cookieStore = await cookies()
  const stateCookie = cookieStore.get('strava_signin_state')?.value
  const nextCookie = cookieStore.get('strava_signin_next')?.value ?? '/att'

  // Clear both transient cookies regardless of outcome — they're single-use.
  const clearCookies = (res: NextResponse) => {
    res.cookies.set('strava_signin_state', '', { path: '/', maxAge: 0 })
    res.cookies.set('strava_signin_next', '', { path: '/', maxAge: 0 })
    return res
  }
  const fail = (errKey: string) =>
    clearCookies(NextResponse.redirect(new URL(`/att/auth?error=${errKey}`, base)))

  if (errorFromStrava) return fail('strava_denied')
  if (!code || !stateFromStrava || !stateCookie || stateFromStrava !== stateCookie) {
    return fail('strava_state_mismatch')
  }

  // 1. Exchange the code for tokens + verify the athlete's identity.
  let tokens
  try {
    tokens = await exchangeCode(code)
  } catch (err) {
    console.error('[strava signin] exchange failed', err)
    return fail('strava_exchange_failed')
  }
  const profile = await getAthleteProfile(tokens.accessToken)
  if (!profile) return fail('strava_profile_failed')

  // Strava removed `email` from /api/v3/athlete in 2018-ish as a privacy
  // policy. Even with profile:read_all granted, the field is never
  // returned. Rather than block sign-in, we synthesise a stable
  // strava-{athleteId}@noreply.paddlesnitch.com address that satisfies
  // Cognito's email-format requirement. The user can add a real contact
  // email later from /profile/me/settings — see src/lib/strava-account.ts and
  // the StravaContactBanner.
  // NOTE: `||`, not `??`. getAthleteProfile normalises a missing Strava email
  // to '' (empty string), and `?? ` only falls back on null/undefined — so with
  // `??` a no-email athlete got accountEmail = '' and AdminCreateUser was called
  // with an empty username, failing InvalidParameterException (masked as
  // 'unknown' → "Could not create an account from your Strava profile"). `||`
  // treats '' as "no email" and falls back to the synthetic address.
  const hasRealEmail = !!profile.email
  const accountEmail = profile.email || syntheticEmailFor(profile.id)

  // 2. Find or create the matching Cognito user.
  //    Priority:
  //      a) Existing athlete index entry  → use the linked Cognito user.
  //      b) Existing email account        → link the athlete to it.
  //         (Only applicable when Strava actually gave us an email;
  //         synth emails are unique-per-athlete so the lookup is
  //         pointless.)
  //      c) Otherwise                     → create a fresh Cognito user.
  let cognitoEmail: string
  const displayName = [profile.firstname, profile.lastname].filter(Boolean).join(' ').trim()
    || accountEmail.split('@')[0]

  const linkedUserId = await getUserIdByAthleteId(profile.id)
  if (linkedUserId) {
    // Resolve the linked Cognito user by the SUB we stored — NOT by the
    // synthetic email. A user who linked Strava from a real email/password
    // account has their real email on the Cognito record, so a synth-email
    // lookup would miss and wrongly fall through to creating a duplicate
    // (the bug behind "Could not create an account from your Strava profile"
    // for already-linked accounts). The sub is stable regardless of email.
    const existing = await findUserBySub(linkedUserId)
    if (existing) {
      cognitoEmail = existing.email
    } else {
      // The linked Cognito user genuinely no longer exists (deleted account).
      // Drop the stale link and create a fresh synth-email account.
      console.warn(`[strava signin] athlete ${profile.id} linked to missing user ${linkedUserId}; relinking`)
      cognitoEmail = accountEmail
      const created = await adminCreateUserForStrava(accountEmail, displayName)
      if ('error' in created) return fail('strava_user_create_failed')
      await putAthleteIndex(profile.id, created.sub)
    }
  } else {
    // Only try the email-merge path when Strava actually gave us an
    // email. The synth path skips straight to creation — there can be
    // no pre-existing account with that synthesised address.
    const existing = hasRealEmail ? await findUserByEmail(accountEmail) : null
    if (existing) {
      cognitoEmail = existing.email
      await putAthleteIndex(profile.id, existing.sub)
    } else {
      const created = await adminCreateUserForStrava(accountEmail, displayName)
      if ('error' in created) {
        console.error('[strava signin] adminCreateUser failed', created.error)
        return fail('strava_user_create_failed')
      }
      cognitoEmail = accountEmail
      await putAthleteIndex(profile.id, created.sub)
      // Pull in any group invitations queued for this email before signup.
      // Synth-email users will hit zero pending invites by construction
      // (nobody invites a strava-{n}@noreply… address), but the call is
      // cheap and the storage layer no-ops when the index is empty.
      try {
        const { applyPendingInvitations } = await import('@/lib/pending-invitations')
        await applyPendingInvitations(accountEmail, created.sub)
      } catch (err) {
        console.error('[strava signin] applyPendingInvitations failed', err)
      }
    }
  }

  // 3. Sign the user in via Custom Auth, using a server-only one-time token.
  const presetToken = randomBytes(32).toString('hex')
  const signInResult = await customAuthSignIn(cognitoEmail, presetToken)
  if ('error' in signInResult) {
    console.error('[strava signin] customAuthSignIn failed', signInResult.error)
    return fail('strava_signin_failed')
  }

  // 4. Persist the Strava tokens against the actual signed-in user id (which
  //    is the Cognito sub, available from the ID token claims).
  const user = await verifyIdToken(signInResult.idToken)
  if (user) {
    await putStravaTokens(user.id, tokens)
  }

  // 5. Set the auth cookies and bounce to where the user was headed.
  const safeNext = nextCookie.startsWith('/') ? nextCookie : '/att'
  const res = NextResponse.redirect(new URL(safeNext, base))
  setAuthCookies(res.cookies, signInResult.idToken, signInResult.refreshToken)
  return clearCookies(res)
}
