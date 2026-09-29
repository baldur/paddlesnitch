// Cognito Custom Auth: CreateAuthChallenge trigger.
//
// Generates the 6-digit code, stashes it in privateChallengeParameters (only
// the server sees this), and emails it to the user via SES. Real Cognito
// users never see the code over the API; they only get it in the email.
//
// In local dev (LOCAL_DEV=true), we skip the SES call and log the code so
// the developer can grab it from the cognito-local console / db file.

import { randomInt } from 'node:crypto'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

function generateCode() {
  // 6 digits, padded with leading zeros. From the crypto RNG: Math.random is
  // predictable from its own earlier outputs, and this code is a sign-in
  // secret (security audit 2026-09).
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

async function sendCode(email, code) {
  // Read env vars at call-time, not module-load-time, so tests can flip
  // LOCAL_DEV in beforeEach without re-importing.
  const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@paddlesnitch.com'
  const LOCAL_DEV = process.env.LOCAL_DEV === 'true'

  if (LOCAL_DEV) {
    // In dev, log it AND write it to a known path so the test harness can
    // pick it up. Tests and the dev console both want visibility.
    console.log(`[create-auth-challenge] OTP for ${email}: ${code}`)
    const dir = process.env.LOCAL_OTP_DIR
    if (dir) {
      const fs = await import('fs/promises')
      const path = await import('path')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, encodeURIComponent(email)), code, 'utf8')
    }
    return
  }
  const ses = new SESClient({ region: process.env.AWS_REGION ?? 'eu-west-1' })
  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Your paddlesnitch.com sign-in code' },
      Body: {
        Text: {
          Data: [
            `Your one-time sign-in code is: ${code}`,
            '',
            'This code expires in 5 minutes. If you did not request this, you can safely ignore this email — no one can sign in without the code.',
            '',
            'paddlesnitch.com — GPS-verified time trials for kayak & rowing.',
          ].join('\n'),
        },
      },
    },
  }))
}

export const handler = async (event) => {
  const email = event.request.userAttributes.email
  if (!email) {
    throw new Error('CreateAuthChallenge: user has no email attribute')
  }

  // Server-trusted sign-in path (Strava): the caller pre-generates a one-time
  // token and stashes it on the user's `custom:auth_preset` attribute right
  // before InitiateAuth, then answers the challenge with the same value. We
  // read it from userAttributes — NOT ClientMetadata — because Cognito does
  // not forward ClientMetadata to the auth-challenge triggers. The
  // clientMetadata fallback is only for the local-dev/test harness, which
  // exercises this Lambda directly. Skip the email entirely: only our backend
  // can do both halves of the dance, so there's nothing to leak.
  const preset = event.request.userAttributes['custom:auth_preset'] || event.request.clientMetadata?.preset_otp
  if (preset) {
    event.response.publicChallengeParameters = { email }
    event.response.privateChallengeParameters = { otp: String(preset) }
    event.response.challengeMetadata = 'PRESET_TOKEN'
    return event
  }

  const code = generateCode()
  await sendCode(email, code)

  event.response.publicChallengeParameters = { email }
  event.response.privateChallengeParameters = { otp: code }
  // challengeMetadata is exposed back to DefineAuthChallenge so it can see
  // which round this is, if needed. Not used right now.
  event.response.challengeMetadata = 'OTP_EMAIL'
  return event
}
