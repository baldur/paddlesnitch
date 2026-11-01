import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getRequestUser, getRequestUserEvenIfErased, clearAuthCookies } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import { deleteObject } from '@/lib/storage'
import { deleteUserBySub, disconnectGoogle, findUserBySub, revoke } from '@/lib/cognito'
import { eraseBetaApplication } from '@/lib/beta-signups'
import { linkNoteKey } from '@/lib/google-link'
import { eraseAccountData, ERASE_AGAIN_AFTER_MS } from '@/lib/account-erasure'
import { enqueueJob } from '@/lib/jobs'
import { markAccountErasing, markAccountErased, isAccountErased } from '@paddlesnitch/core/erased'
import { eraseGameTimes } from '@paddlesnitch/core/games'

const REAUTH_TEXT = 'For your safety, deleting your account needs a recent sign-in. Please sign in again.'

// GET /api/account — whether deleting can go ahead now ({ recentSignIn }), so
// the account page and the apps ask for a fresh sign-in BEFORE someone types
// DELETE rather than after.
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ recentSignIn: await hasRecentSignIn(req, user.id) })
}

// DELETE: GDPR Art. 17 (right to erasure). Permanently removes:
//   - the Cognito user record (no more sign-ins)
//   - every course and trial they created that no group owns and nobody else
//     has results in. Anything with other people's results, or owned by a
//     group, stays (audit decision 2026-09: deleting an account must not
//     delete other people's records); only this user's entries leave it
//   - every entry they ever submitted, in any trial, owned or not
//   - every failed-upload diagnostic (GPS track) they left, in any trial
//   - every paddle, the coach profile, and the share link of any shared paddle
//   - every river plan and the link of any shared plan
//   - every tracker they own (signed out) and every recording they uploaded
//   - their Strava link (deauthorised, and the athlete -> account index)
//   - their place in groups; a group they own passes to an admin or member
//   - the private contact records behind issue reports they filed
//   - a beta tester application made with their account email
//   - everything under users/{userId}/
// After pulling their entries out of trials they don't own, the affected
// leaderboards get rebuilt so the public view stays consistent. The data part
// is lib/account-erasure.ts, which a job runs again ~2.5 min later (#814).
//
// Deleting needs a real sign-in from the last 10 minutes (owner, 2026-10-25):
// a stolen or left-open session must not be able to erase everything. Not a
// password prompt, because accounts made through Strava have none.
export async function DELETE(req: Request) {
  // Even a deleted account's token: asking again after the first answer was
  // lost must succeed. It answers done without running again, so it never
  // turns 'done' back into 'pending' (which would let the old tokens back in,
  // #795) and never deletes by an email someone may have signed up with since.
  const user = await getRequestUserEvenIfErased(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await isAccountErased(user.id)) {
    const done = NextResponse.json({ ok: true }, { status: 200 })
    clearAuthCookies(done.cookies)
    return done
  }
  if (!(await hasRecentSignIn(req, user.id))) {
    return NextResponse.json({ error: REAUTH_TEXT, reauth: true }, { status: 403 })
  }

  // 0. First, so a phone still holding this account's token waits while the rest
  //    is deleted (C3: phones upload by themselves). Marked done only once the
  //    sign-in account is gone, so a delete that fails leaves the phone's files.
  //    While 'pending', the account's tokens still work (#795: a delete that
  //    fails must not lock out a live account), so a write can land after its
  //    area was erased; the second pass below catches it.
  await markAccountErasing(user.id)

  // 0a. The second pass (#814), written before anything is deleted so a delete
  //     cut off after 'done' still gets it. It runs once the last write the
  //     old token can start (on a server that cached 'none' for up to a minute,
  //     @paddlesnitch/core/erased) has run out its 30 s, plus a margin, and only
  //     if the marker says 'done' by then: a delete that fails leaves
  //     'pending', and the job does nothing to a live account. It holds only
  //     the account ID.
  await enqueueJob('erase-account-again', { userId: user.id },
    { notBefore: new Date(Date.now() + ERASE_AGAIN_AFTER_MS) })

  // 1–6. Everything keyed by the account ID. A Strava sign-in account may have
  //      no tokens left, but its synthetic email still names the athlete.
  const synthetic = /^strava-(\d+)@noreply\.paddlesnitch\.com$/.exec(user.email)
  await eraseAccountData(user.id, { athleteIds: synthetic ? [Number(synthetic[1])] : [] })
  // Keyed by email: only an address the account has proved is theirs (#713).
  // Not in the second pass: the form is open to anyone, so by then a record
  // under this email may be someone else's.
  if (user.emailVerified) await eraseBetaApplication(user.email)
  // A Connect Google note left in the last 10 minutes (lib/google-link.ts).
  // Not in the second pass either: a note left meanwhile runs out in 10
  // minutes, names an account that can no longer sign in, and a lifecycle
  // rule removes it.
  await deleteObject(linkNoteKey(user.email))

  // 7. Revoke any active refresh token then delete the Cognito user.
  //    Order matters: if Cognito delete fails we want their session still revoked.
  //    An app has no cookie: it may send its refresh token as { refreshToken }.
  const cookieStore = await cookies()
  const body = await req.json().catch(() => ({})) as { refreshToken?: unknown }
  const refreshToken = cookieStore.get('tt_refresh')?.value
    ?? (typeof body.refreshToken === 'string' ? body.refreshToken : undefined)
  if (refreshToken) await revoke(refreshToken)
  // A Google login connected on Account stops opening anything first.
  const linked = (await findUserBySub(user.id))?.googleId
  if (linked) await disconnectGoogle(linked)
  // By sub: a Google account's username isn't its email.
  await deleteUserBySub(user.id)
  await markAccountErased(user.id)
  // Their times on the game's public leaderboards (games/kayak/leaderboard/;
  // live races expire within a day). Last, after the 'done' marker: the ID
  // token in a game tab still open stays valid for up to 24 h, and only that
  // marker signs it out (#742, #795), so a time posted while the delete ran is
  // caught here. Writes in the other areas, and a time posted on a server that
  // still had the account cached as live, wait for the second pass (0a).
  await eraseGameTimes(user.id)

  // 8. Clear cookies on the response so the browser stops sending stale ones.
  const res = NextResponse.json({ ok: true }, { status: 200 })
  clearAuthCookies(res.cookies)
  return res
}
