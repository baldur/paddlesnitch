// Where to send someone who has signed in but hasn't accepted the current
// Terms: the accept page, then on to where they were going. Only the password
// sign-up form had the Terms box, so accounts made by email code or Strava (and
// everyone from before v002) never agreed to them (audit decision 2026-09).
// Pure, so the sign-in page can use it too.
export function termsAcceptPath(next: string): string {
  return `/terms/accept?next=${encodeURIComponent(next)}`
}
