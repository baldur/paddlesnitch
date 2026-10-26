import { rateLimit, emailKey, clientIpKey } from '@paddlesnitch/core/rate-limit'

// Every sign-up code is an email from the pool's small daily allowance (50,
// Cognito's own sender), shared with password-reset codes. So sending one is
// limited per address and per IP, like the reset and email-code routes (#702).
export const TOO_MANY_CODES = 'We’ve sent this email too many codes. Please wait an hour and try again.'

export async function mayEmailCode(req: Request, email: string): Promise<boolean> {
  const byEmail = await rateLimit(`signup-code/email/${emailKey(email)}`, 5, 3600)
  if (!byEmail.allowed) return false
  const ip = clientIpKey(req)
  if (!ip) return true
  return (await rateLimit(`signup-code/ip/${ip}`, 20, 3600)).allowed
}
