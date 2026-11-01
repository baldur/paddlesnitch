// Accounts made with Sign in with Strava (removed 2026-11). Strava never shared
// an email, so those accounts got a placeholder address,
// strava-{athleteId}@noreply.paddlesnitch.com, that no mail reaches. They can't
// sign in any more; the sign-in page tells them to email us, and we move the
// account to a real email by hand. The apps and the account page still treat
// them specially (GET /api/account/contact → placeholderEmail), and nothing is
// ever emailed to the placeholder.

// True iff this email is such a placeholder.
export function isSyntheticStravaEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return /^strava-\d+@noreply\.paddlesnitch\.com$/i.test(email)
}
