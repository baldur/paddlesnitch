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
// Connect Google (Account): the one exception. A signed-in person asks to
// connect Google; our server leaves a 10-minute note keyed by their email
// (auth/google-links/<sha256 of the email>.json, lib/google-link.ts) and sends
// them to Google. When Google then arrives here with that same verified email,
// and the note names the account that holds it, the Google login is linked
// to that account (AdminLinkProviderForUser) instead of making a new one, and
// "LINKED" stops this sign-up: the next Google sign-in opens the account.
//
// Half-made accounts (UNCONFIRMED: Cognito's own sign-up page, which never
// confirms) don't block anyone. Throwing stops the sign-up; for Google,
// Cognito sends the browser back to our callback with `error_description`
// holding the message, which the callback turns into words.
import { createHash } from 'crypto'
import { AdminLinkProviderForUserCommand, CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'

async function usersWithEmail(userPoolId, email) {
  const client = new CognitoIdentityProviderClient({})
  const res = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email.replace(/"/g, '\\"')}"`,
    Limit: 10,
  }))
  return res.Users ?? []
}

/** Where the server leaves a connect-Google note: the same key as apps/web/src/lib/google-link.ts. */
export const linkKey = (email) => `auth/google-links/${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}.json`

// The note, read and deleted (it works once). Null when there is none, or it
// can't be read: then the sign-up is refused as before.
async function takeLinkNote(email) {
  const bucket = process.env.DATA_BUCKET
  if (!bucket) return null
  try {
    // Lambda's Node runtime has the SDK; loaded here so tests never need it.
    const { S3Client, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({})
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: linkKey(email) })).catch(e => {
      if (e?.name === 'NoSuchKey') return null
      throw e
    })
    if (!res) return null
    const note = JSON.parse(await res.Body.transformToString())
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: linkKey(email) }))
    return note
  } catch (err) {
    console.warn('[pre-sign-up] could not read a connect-Google note', err?.name)
    return null
  }
}

async function linkGoogle(userPoolId, username, googleId) {
  await new CognitoIdentityProviderClient({}).send(new AdminLinkProviderForUserCommand({
    UserPoolId: userPoolId,
    DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: username },
    SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: googleId },
  }))
}

const CHECKED = new Set(['PreSignUp_ExternalProvider', 'PreSignUp_SignUp', 'PreSignUp_AdminCreateUser'])

// Lambda calls handler(event, context): the second argument is Lambda's
// context, never ours. (It once was `deps = {…}`, which Lambda filled with its
// context, so every check died with "usersWithEmail is not a function".)
export const handler = (event) => check(event, { usersWithEmail, takeLinkNote, linkGoogle })

export async function check(event, deps) {
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
  // Only an account that proved the address counts: anyone can set their own
  // email to someone else's through the public client (it stays unverified),
  // and that mustn't stop the real owner signing up (#713).
  const verified = (u) => (u.Attributes ?? []).some(x => x.Name === 'email_verified' && x.Value === 'true')
  const existing = (await deps.usersWithEmail(event.userPoolId, email)).filter(u => u.UserStatus !== 'UNCONFIRMED' && verified(u))
  if (existing.length && google && existing.length === 1 && deps.takeLinkNote) {
    // Connect Google: only for the account the note names, before it runs out.
    const [owner] = existing
    const sub = (owner.Attributes ?? []).find(x => x.Name === 'sub')?.Value
    const note = await deps.takeLinkNote(email)
    const googleId = String(event.userName ?? '').replace(/^google_/i, '')
    if (note && sub && note.userId === sub && note.expiresAt > Date.now() && googleId && !String(owner.Username).startsWith('Google_')) {
      await deps.linkGoogle(event.userPoolId, owner.Username, googleId)
      console.log('[pre-sign-up] Google linked to an existing account')
      throw new Error('LINKED')
    }
  }
  if (existing.length) throw new Error('ACCOUNT_EXISTS')
  return event
}
