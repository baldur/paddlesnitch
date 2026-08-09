import Link from 'next/link'
import AppHeader from '@/components/AppHeader'

export const metadata = {
  title: 'Privacy Policy — paddlesnitch.com',
}

export default function PrivacyPolicy() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">
              ← HOME
            </Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">PRIVACY</span>
          </>
        }
      />

      <article className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full text-sm text-fg leading-relaxed">
        <h1 className="text-lg font-bold tracking-widest mb-2">PRIVACY POLICY</h1>
        <p className="text-xs text-muted mb-8">Last updated: 31 May 2026</p>

        <Section title="Who runs paddlesnitch.com">
          <p>
            paddlesnitch.com is run by Baldur Gudbjornsson, the data controller for this service. For
            questions or requests about your personal data, email{' '}
            <a href="mailto:privacy@paddlesnitch.com" className="tt-link">
              privacy@paddlesnitch.com
            </a>
            . The site is hosted on Amazon Web Services in the eu-west-1 region (Ireland).
          </p>
        </Section>

        <Section title="What data we collect">
          <p>We only collect data you give us by signing up and using the site:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Email address</strong> — used to sign you in.</li>
            <li><strong>Display name</strong> — shown to other users on leaderboards.</li>
            <li><strong>Password hash</strong> — held by Amazon Cognito; we never see your plaintext password.</li>
            <li><strong>GPS traces you upload</strong> — the raw file (GPX, FIT, or CSV) and the derived race result (elapsed time, 500 m splits).</li>
            <li><strong>Crew names and seat numbers</strong> — if you submit on behalf of a multi-person boat.</li>
            <li><strong>Race date</strong> — the date you raced, as you entered it.</li>
            <li><strong>Boat class</strong> — K1, 2X, 8+, etc.</li>
          </ul>
          <p className="mt-3">
            <strong>Heart-rate and cadence are explicitly discarded</strong> at parse time, even if your
            GPS file contains them. We never store, display, or transmit biometric data.
          </p>
        </Section>

        <Section title="Why we hold this data (legal basis)">
          <p>
            We process this data under <em>performance of a contract</em> (UK GDPR Art. 6(1)(b)): you
            sign up to use the service, and the service cannot rank your time without knowing who you are,
            what boat you raced in, and what your GPS trace says. We do not process your data for any
            other purpose — no marketing, no analytics, no profiling.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We hold your data for as long as your account exists. You can delete it at any time from your{' '}
            <Link href="/profile/me/settings" className="tt-link">account page</Link>{' '}
            — that removes your user record, all courses and trials you created, all entries you
            submitted, and rebuilds any affected leaderboards. The deletion is immediate and
            irreversible.
          </p>
        </Section>

        <Section title="Your rights">
          <p>Under UK GDPR you can:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Access</strong> a copy of your data — use the &quot;Download my data&quot; button on your account page.</li>
            <li><strong>Erase</strong> your data — use the &quot;Delete my account&quot; button on your account page.</li>
            <li><strong>Rectify</strong> incorrect data — email us; for display name you can also edit it in Cognito.</li>
            <li><strong>Port</strong> your data — the export download is a machine-readable JSON file.</li>
            <li><strong>Object</strong> or restrict processing — email us.</li>
            <li><strong>Complain</strong> to the Information Commissioner&apos;s Office (
              <a href="https://ico.org.uk" className="tt-link">ico.org.uk</a>
            ) if you think we&apos;ve mishandled your data.</li>
          </ul>
        </Section>

        <Section title="Cookies">
          <p>We set <strong>two</strong> cookies, both strictly necessary for signing you in:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><code>tt_id</code> — your sign-in token (a signed JWT from Cognito). 24 hour lifetime.</li>
            <li><code>tt_refresh</code> — used to keep you signed in across sessions. 30 day lifetime.</li>
          </ul>
          <p className="mt-3">
            We do not use analytics cookies, advertising cookies, or any third-party trackers. The map
            tiles are fetched from CARTO and OpenStreetMap and do not receive any of your personal data.
          </p>
        </Section>

        <Section title="Third parties we share data with">
          <p>We use a small number of processors to run the service:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Amazon Web Services</strong> (eu-west-1, Ireland) — hosting, user pool (Cognito), and storage (S3).</li>
            <li><strong>Amazon SES</strong> — to send transactional emails (sign-in codes, password resets) from <code>noreply@paddlesnitch.com</code>.</li>
            <li><strong>CARTO</strong> and <strong>OpenStreetMap</strong> — map background tiles. Their servers see your IP and the map tile you requested; they do not see any of your account data.</li>
          </ul>
          <p className="mt-3">
            We do not sell your data, share it with advertisers, or transfer it outside the European
            Economic Area.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change how we handle your data we&apos;ll update this page and bump the &quot;last updated&quot;
            date at the top. For significant changes (new categories of data, new processors) we&apos;ll
            email registered users before the change takes effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            <a href="mailto:privacy@paddlesnitch.com" className="tt-link">
              privacy@paddlesnitch.com
            </a>
          </p>
        </Section>
      </article>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}
