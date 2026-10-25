// Cognito PreSignUp trigger: one account per email (#697).
//
// Our sign-ins find people by email (an alias), so two accounts sharing one
// email could put someone into the other's account (security review, #697).
// So every new account is refused when a confirmed account already has its
// email, whichever way either was made:
//  - a Google sign-up whose email already has an account: the owner's
//    decision is that Google is linked only from Account, never by email,
//    because email sign-up doesn't prove who owns the address;
//  - an email sign-up, or Strava's AdminCreateUser, whose email already
//    belongs to a Google account.
// A Google account must also come with an email Google has verified.
//
// Half-made accounts (UNCONFIRMED: Cognito's own sign-up page, which never
// confirms) don't block anyone. Throwing stops the sign-up; for Google,
// Cognito sends the browser back to our callback with `error_description`
// holding the message, which the callback turns into words.
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'

async function usersWithEmail(userPoolId, email) {
  const client = new CognitoIdentityProviderClient({})
  const res = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email.replace(/"/g, '\\"')}"`,
    Limit: 10,
  }))
  return res.Users ?? []
}

const CHECKED = new Set(['PreSignUp_ExternalProvider', 'PreSignUp_SignUp', 'PreSignUp_AdminCreateUser'])

export async function handler(event, deps = { usersWithEmail }) {
  if (!CHECKED.has(event.triggerSource)) return event
  const attrs = event.request?.userAttributes ?? {}
  const email = (attrs.email ?? '').trim().toLowerCase()
  const google = event.triggerSource === 'PreSignUp_ExternalProvider'
  if (google) {
    // Our accounts are keyed by email: a Google account without a verified one can't sign in.
    if (!email) throw new Error('NO_EMAIL')
    if (String(attrs.email_verified).toLowerCase() !== 'true') throw new Error('EMAIL_UNVERIFIED')
  }
  if (!email) return event
  // Any confirmed account with this email blocks, a Google one included:
  // PreSignUp only runs when Cognito is about to make a NEW user, so a Google
  // account already holding the email is a different Google identity.
  const existing = (await deps.usersWithEmail(event.userPoolId, email)).filter(u => u.UserStatus !== 'UNCONFIRMED')
  if (existing.length) throw new Error('ACCOUNT_EXISTS')
  return event
}
