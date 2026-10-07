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
