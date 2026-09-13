// Thin SES wrapper used for transactional emails sent from the Next.js
// server function. Cognito-side auth emails (sign-in OTP) live in their
// own Lambda trigger; this is for app-flows like group invitations.
//
// Local dev no-ops and logs to console so we don't accidentally hit SES
// from `pnpm dev`. Same `isDev()` check the storage layer uses.

const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@paddlesnitch.com'

function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.USE_LOCAL_STORAGE === 'true'
}

export type SendEmailInput = {
  to: string
  subject: string
  text: string
}

// Sends a plain-text email via SES. Returns true if the message was sent
// (or logged in dev), false on failure — callers decide whether a failed
// send should fail the whole operation. For invitation flows we
// deliberately swallow failures: the invite record is already persisted,
// so a missed email is recoverable (admin can resend).
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  if (isDev()) {
    console.log(`[email] To ${input.to}: ${input.subject}\n${input.text}`)
    return true
  }
  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses')
    const ses = new SESClient({ region: process.env.AWS_REGION ?? 'eu-west-1' })
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [input.to] },
      Message: {
        Subject: { Data: input.subject },
        Body: { Text: { Data: input.text } },
      },
    }))
    return true
  } catch (err) {
    console.error('[email] SES send failed', err)
    return false
  }
}
