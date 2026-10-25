// Cognito PreSignUp trigger: refuses a Google sign-in whose email already has
// a paddlesnitch account (owner's decision, #697). Google is linked to an
// existing account only from Account, by someone signed in there; never by a
// matching email, because email sign-up doesn't prove who owns the address.
//
// Cognito runs this before it creates the Google user. Throwing stops the
// sign-up, and Cognito sends the browser back to our callback with
// `error_description` containing "ACCOUNT_EXISTS", which the callback turns
// into a message. Every other sign-up (email, Strava's AdminCreateUser) passes.
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

export async function handler(event, deps = { usersWithEmail }) {
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') return event
  const email = (event.request?.userAttributes?.email ?? '').trim().toLowerCase()
  // Our accounts are keyed by email: a Google account without one can't sign in.
  if (!email) throw new Error('NO_EMAIL')
  const existing = await deps.usersWithEmail(event.userPoolId, email)
  // Another Google sign-in with the same email is the same Google user (Cognito
  // keys it by Google's sub), so only a non-Google account blocks it.
  if (existing.some(u => u.UserStatus !== 'EXTERNAL_PROVIDER')) throw new Error('ACCOUNT_EXISTS')
  return event
}
