import { disconnectGoogle, findUserByEmail, signOutEverywhere } from '@/lib/cognito'
import { markEmailProven } from '@/lib/email-proven'

// After a password reset (#702). Until 2026-10-26 anyone could create an
// account on an address they didn't own, so the person resetting may be the
// address's real owner taking it back. Every session ends (the old holder's
// refresh tokens stop working), and a Google login connected on Account is
// disconnected.
// The reset itself proves the address from now on.
export async function afterPasswordReset(email: string): Promise<void> {
  // If the other sessions couldn't be ended, the account isn't marked proven:
  // the next reset tries the whole thing again.
  let signedOut = true
  try {
    await signOutEverywhere(email)
  } catch (err) {
    signedOut = false
    console.error('[password-reset] couldn’t end the account’s other sessions', err)
  }
  const user = await findUserByEmail(email).catch(err => {
    console.error('[password-reset] couldn’t look up the account', err)
    return null
  })
  if (!user) return
  try {
    // A connected Google login stops opening the account too: the reset is
    // the way to cut every other way in off. Connect it again from Account.
    if (user.googleId) await disconnectGoogle(user.googleId)
    if (signedOut) await markEmailProven(user.sub, 'password_reset')
  } catch (err) {
    console.error('[password-reset] couldn’t finish checking the account', err)
  }
}
