'use client'
import ContactBanner from '@paddlesnitch/ui/ContactBanner'
import { isSyntheticStravaEmail } from '@/lib/strava-account'

// att's adapter around the shared ContactBanner. Show it to Strava-only accounts
// (synthetic email) that haven't saved a real contact email yet. Same rule as
// the old StravaContactBanner, now on the shared component.
async function shouldShow(): Promise<boolean> {
  const me = await fetch('/att/api/auth/me').then(r => (r.ok ? r.json() : null))
  if (!me || !isSyntheticStravaEmail(me.email)) return false
  const contact = await fetch('/att/api/account/contact').then(r => (r.ok ? r.json() : null))
  return !contact?.contact?.email
}

export default function AttContactBanner() {
  return (
    <ContactBanner
      shouldShow={shouldShow}
      href="/att/account"
      cta="Add a contact email →"
      message="You signed in with Strava, so we can’t reach you about Terms changes, account problems, or group invitations."
      dismissKey="tt_strava_email_banner_dismissed"
    />
  )
}
