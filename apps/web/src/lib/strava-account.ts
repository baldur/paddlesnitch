// Helpers for Strava-only accounts (users who signed in via Strava and
// don't have a real email address on file — Strava doesn't share emails
// with third-party apps, even with the profile:read_all scope).
//
// We give those users a synthesised email that satisfies Cognito's
// email-format requirement without ever being delivered to. The address
// uses the `noreply.paddlesnitch.com` subdomain so it's visually clear
// it's never a real mailbox, and pins the user back to their athlete id
// so the relationship is reversible.

// Subdomain (not the apex) so a bounced delivery NEVER looks like it
// came from a real paddlesnitch.com mailbox. We never publish MX records
// for this subdomain.
const SYNTH_DOMAIN = 'noreply.paddlesnitch.com'

export function syntheticEmailFor(athleteId: number): string {
  return `strava-${athleteId}@${SYNTH_DOMAIN}`
}

// True iff this email was minted by us for a Strava-only account. The
// UI uses this to decide whether to show the "add a real email" banner
// and to skip wiring up password-reset flows that can't possibly
// deliver.
export function isSyntheticStravaEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return /^strava-\d+@noreply\.paddlesnitch\.com$/i.test(email)
}

// Inverse — pulls the athlete id back out of a synthesised email so we
// can repair the strava-athletes index from an account on demand.
// Returns null if the email isn't a synthesised one.
export function athleteIdFromSyntheticEmail(email: string | undefined | null): number | null {
  if (!email) return null
  const match = email.match(/^strava-(\d+)@noreply\.paddlesnitch\.com$/i)
  return match ? Number(match[1]) : null
}
