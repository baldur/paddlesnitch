import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { ButtonLink } from '@paddlesnitch/ui/Button'

// Installing the Android app before it's on Google Play. Not in the menu or
// the search engines yet: the link is shared by hand while the app is early.
export const metadata = { title: 'Android app', robots: { index: false } }

export default function AndroidPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/" className="tt-nav-link text-sm">← Home</Link>} />
      <Page>
        <PageHeader title="Android app" />
        <p className="text-muted">
          An early version of the paddlesnitch app, for phones with Android 10 or newer. It isn’t on Google Play yet, so your phone asks before installing it.
        </p>
        <div>
          <ButtonLink variant="primary" href="/android/download">Download the app</ButtonLink>
        </div>

        <Section title="Install it">
          <ol className="list-decimal pl-5 flex flex-col gap-2">
            <li>On your Android phone, tap Download the app.</li>
            <li>Open the file when it has downloaded.</li>
            <li>If your phone asks, allow your browser to install apps, then go back and tap Install.</li>
            <li>If Google Play Protect warns about an unknown app, tap More details, then Install anyway.</li>
            <li>Open paddlesnitch and sign in with your paddlesnitch account.</li>
          </ol>
        </Section>

        <Section title="Update it">
          <p>Download it again and install it over the one you have. You stay signed in.</p>
        </Section>

        <Section title="iPhone">
          <p>An iPhone app is on the way. Until then, paddlesnitch.com works in Safari.</p>
        </Section>
      </Page>
    </main>
  )
}
