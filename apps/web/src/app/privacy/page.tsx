import Link from 'next/link'
import AppHeader from '@/components/AppHeader'

export const metadata = {
  title: 'Privacy policy',
}

export default function PrivacyPolicy() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">
              ← HOME
            </Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">PRIVACY</span>
          </>
        }
      />

      <article className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full text-sm text-fg leading-relaxed">
        <h1 className="text-lg font-bold tracking-widest mb-2">PRIVACY POLICY</h1>
        <p className="text-xs text-muted mb-8">Last updated: 28 September 2026</p>

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

        <Section title="What we collect">
          <p>Only what you give us, or what your GPS files and tracker record:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Account</strong>: your email address, display name and password. Amazon Cognito holds the password; we never see it. If you sign in with Strava, which doesn&apos;t share your email, you can add a contact email.</li>
            <li><strong>Public profile</strong>: off unless you turn it on, plus the profile handle if you pick one.</li>
            <li><strong>Time-trial results</strong>: the track from the GPS file you upload (times, positions and stroke rate; we don&apos;t keep the file itself), and your time, 500 m splits, average stroke rate, boat class and crew names.</li>
            <li><strong>Paddles</strong>: the analysis of each paddle you add (from a file, Strava, a time trial or a tracker): your route, speed and stroke rate, plus any diary notes and boat class you add. For files uploaded to Paddles we keep the analysis, not the original file.</li>
            <li><strong>Trackers</strong>: if you link a paddlesnitch tracker, the recordings it uploads (GPS positions and motion data), and its ID, software version and when it last synced.</li>
            <li><strong>Strava</strong>: if you connect Strava, a key that lets us read your activities, and the activities you import.</li>
            <li><strong>Automatic paddle summaries</strong>: to write the short summary under a paddle, we send that paddle&apos;s numbers, the name of the nearest river gauge, your recent paddles and your diary notes to an AI model on Amazon Bedrock. Please don&apos;t put health details in diary notes. We keep a short written profile of your paddling to make later summaries relevant.</li>
            <li><strong>Issue reports</strong>: what you write, the page you were on and your browser. If you&apos;re signed in, or add an email, we keep your name and email privately so we can reply.</li>
            <li><strong>Beta tester applications</strong>: your name, email, how you paddle (kayak, rowing and so on), and how often. We use it only to choose and contact beta testers, and delete it when the beta ends or when you ask.</li>
            <li><strong>Page-view counts</strong>: which pages are opened, with a random ID that lasts until you close the tab. It isn&apos;t linked to your account.</li>
            <li><strong>Technical records</strong>: when a tracker checks for a software update we record its IP address and software version (kept 90 days), and we briefly keep IP addresses to stop repeated requests (1 day).</li>
            <li><strong>Emails to us</strong>: if you email privacy@paddlesnitch.com we keep the message so we can deal with it.</li>
          </ul>
          <p className="mt-3">
            <strong>Heart rate is never stored</strong>, even if your GPS file contains it. Stroke rate is
            kept, because it&apos;s part of the analysis.
          </p>
        </Section>

        <Section title="Why we hold this data (legal basis)">
          <p>
            We use your data to provide the service you signed up for: timing your races, analysing your
            paddles and running your groups (<em>performance of a contract</em>, UK GDPR Art. 6(1)(b)). We
            count page views and keep issue reports to find and fix problems (<em>legitimate
            interests</em>, Art. 6(1)(f)). We don&apos;t use your data for marketing or advertising, and we
            don&apos;t sell it.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your data for as long as your account exists. You can delete your account at any time
            from your{' '}
            <Link href="/account" className="tt-link">account page</Link>. That deletes your
            account, paddles, diary notes, results, shared links and tracker recordings, and disconnects
            Strava. Courses and trials you created are deleted too, unless a group owns them or someone
            else has a result in them: those stay for the other paddlers, without your results. It
            happens at once and can&apos;t be undone. Our storage keeps earlier copies for 30 days so we
            can recover from mistakes, so deleted data is fully gone 30 days later. Server logs are kept
            for 90 days.
          </p>
        </Section>

        <Section title="Your rights">
          <p>Under UK GDPR you can:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Access</strong> a copy of your data: use &quot;Download my data&quot; on your account page.</li>
            <li><strong>Erase</strong> your data: use &quot;Delete my account&quot; on your account page.</li>
            <li><strong>Correct</strong> wrong data: email us.</li>
            <li><strong>Take your data elsewhere</strong>: the download is a machine-readable JSON file.</li>
            <li><strong>Object</strong> to or restrict how we use it: email us.</li>
            <li><strong>Complain</strong> to the Information Commissioner&apos;s Office (
              <a href="https://ico.org.uk" className="tt-link">ico.org.uk</a>
            ) if you think we&apos;ve mishandled your data.</li>
          </ul>
        </Section>

        <Section title="Cookies and browser storage">
          <p>We set these cookies, all needed for the site to work:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><code>tt_id</code>: your sign-in token. Lasts 24 hours.</li>
            <li><code>tt_refresh</code>: keeps you signed in between visits. Lasts 30 days.</li>
            <li><code>strava_state</code>, <code>strava_signin_state</code> and <code>strava_signin_next</code>: only while you connect or sign in with Strava, to check the reply really came from Strava and to bring you back to the right page. Last 10 minutes.</li>
            <li><code>ps_contact_banner_dismissed</code>: only if you sign in with Strava and hide the &quot;add your email&quot; banner. Lasts 180 days.</li>
          </ul>
          <p className="mt-3">
            Your browser also stores <code>tt_cookie_acked</code> (so this notice isn&apos;t shown twice)
            and <code>tt_sid</code> (the random page-view ID, deleted when you close the tab). We use no
            advertising cookies and no third-party trackers.
          </p>
        </Section>

        <Section title="Who else sees data">
          <p>We use these services to run the site:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Amazon Web Services</strong> (eu-west-1, Ireland): hosting, sign-in (Cognito), storage (S3), email (SES, from <code>noreply@paddlesnitch.com</code>) and the AI model that writes paddle summaries (Bedrock). Bedrock doesn&apos;t use your data to train models.</li>
            <li><strong>Strava</strong> (USA): only if you connect it. We read your activities; we never post.</li>
            <li><strong>Open-Meteo</strong> and the <strong>Environment Agency</strong>: we send them a location and a time to look up the wind and river flow for a paddle. Nothing that identifies you.</li>
            <li><strong>GitHub</strong> (USA): issue reports are filed there, and <strong>the text you write is public</strong>. Your name and email are not sent.</li>
            <li><strong>Esri</strong> and <strong>unpkg</strong>: your browser loads map tiles and map icons from them, so they see your IP address. They don&apos;t see your account.</li>
            <li><strong>Google</strong> (Gmail, USA): emails you send to privacy@paddlesnitch.com, and beta tester applications, are forwarded to our Gmail inbox so we can answer them.</li>
          </ul>
          <p className="mt-3">
            Strava, GitHub and Google are in the USA. Everything else we store stays in the EU.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change how we handle your data we&apos;ll update this page and the &quot;last updated&quot;
            date at the top. For significant changes (new kinds of data, new services) we&apos;ll email
            registered users before the change takes effect.
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
