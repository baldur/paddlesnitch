// Can the site email people other than the owner? Not yet: Amazon SES
// production access was refused (2026-09, security audit), so the account is
// still in the SES sandbox and only verified addresses receive mail. Sign-in
// codes and password-reset codes to anyone else are silently dropped.
//
// While this is false the site doesn't offer what needs an email: the EMAIL
// CODE sign-in tab is hidden and "forgot password" explains what to do
// instead. Flip it to true once `aws sesv2 get-account` shows
// ProductionAccessEnabled: true.
export const EMAIL_DELIVERY = false

// Password-reset codes are different: Cognito sends those itself (forgot
// password), and since 2026-10-25 the user pool uses Cognito's own email
// sender instead of SES (infra/lib/att-stack.ts), which the SES sandbox doesn't
// limit: 50 emails a day, from no-reply@verificationemail.com. So reset works
// for everyone. Sign-in codes stay off: our CreateAuthChallenge Lambda sends
// those through SES. Move the pool back to SES (and drop this) once SES
// production access lands.
export const RESET_EMAIL = true
