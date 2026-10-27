import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import type { Metadata } from 'next'
import BetaTestersLanding from '@/components/campaigns/BetaTestersLanding'
import { resolveCampaign, type CampaignLanding } from '@/lib/campaigns'
import { getAuthUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { cardClass, Chevron, Stat } from '@paddlesnitch/ui/Card'
import { Eyebrow } from '@paddlesnitch/ui/Layout'
import { fmtDay } from '@paddlesnitch/core/format'
import { fmtClock } from '@paddlesnitch/analysis/analysis'
import { projectRoute } from '@paddlesnitch/timing/geo'
import { SAMPLE_PADDLE, type RouteKind, type SamplePaddle } from './home-sample-paddle'
import { stravaOn } from '@/lib/sign-in-options'

const DEFAULT_METADATA: Metadata = {
  title: 'paddlesnitch.com — tools for the river',
  description: 'Time trials and paddle analysis for kayakers and rowers.',
}

// A campaign link is usually shared on social media, so it gets its own title,
// description and preview image.
const CAMPAIGN_METADATA: Partial<Record<CampaignLanding, Metadata>> = {
  betatesters: {
    title: 'Beta testers wanted — paddlesnitch',
    description: 'Help test the paddlesnitch tracker on the water. You need to paddle or row, and be able to keep the tracker reasonably dry.',
    openGraph: {
      title: 'Beta testers wanted — paddlesnitch',
      description: 'Help test the paddlesnitch tracker on the water.',
      images: ['https://paddlesnitch.com/campaigns/betatesters.jpg'],
    },
  },
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string | string[] }>
}): Promise<Metadata> {
  const r = resolveCampaign((await searchParams).campaign)
  return (r.found && CAMPAIGN_METADATA[r.landing as CampaignLanding]) || DEFAULT_METADATA
}

// What's here, as a short list under the sample paddle. The sample paddle
// already shows what Paddles does, so each row is one line.
const PRODUCTS = [
  { name: 'Paddles', line: 'Every paddle on a map: pace, stroke rate, efforts and rests, wind and river flow.', href: '/paddles' },
  { name: 'Trials', line: 'Race a course drawn on the map, timed from your GPS file, with 500 m splits.', href: '/att' },
  { name: 'Plan', line: 'Plan a river route: distance, locks and weirs, and where to get in and out.', href: '/plan' },
]

// The campaign landings we can serve. `example1` reuses the default content
// with a visible marker; add genuinely different variants here as needed.
const LANDINGS: Record<'default' | CampaignLanding, (key: string) => React.ReactNode> = {
  default: () => <LandingContent />,
  example1: () => <LandingContent variant="example1" />,
  betatesters: () => <BetaTestersLanding />,
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string | string[] }>
}) {
  // A known campaign link shows its landing to everyone: people share these
  // links, and a signed-in paddler who taps one should see what was shared, not
  // their dashboard.
  // Otherwise: signed in → your paddles (/paddles is the signed-in home; it
  // used to be a third copy of the dashboard here); signed out → the default
  // marketing landing.
  const { campaign } = await searchParams
  const r = resolveCampaign(campaign)
  if (!r.found && await getAuthUser()) redirect('/paddles')

  // Log every campaign arrival (served variant or fallback) so it's traceable
  // in the server (CloudWatch) logs. Only logs when a campaign was requested,
  // so a normal visit stays quiet.
  if (r.requested) {
    console.log(`[campaign] ${JSON.stringify({ requested: r.requested, landing: r.landing, found: r.found })}`)
  }
  const render = LANDINGS[r.landing] ?? LANDINGS.default
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<span className="text-muted text-sm hidden sm:inline">Tools for the river</span>} />
      {render(r.landing)}
    </main>
  )
}

// The page body, split out so it can be rendered in a test without the
// client-only AppShell header. It leads with a real paddle (design-system.md,
// decision 5): the route, the numbers and the summary a paddler gets, drawn on
// the server with no client JavaScript. Then the three sections as a short list.
export function LandingContent({ variant }: { variant?: string } = {}) {
  const p = SAMPLE_PADDLE
  return (
    // A campaign landing is marked in the markup (for tests and analytics),
    // never in text a visitor can see.
    <div data-campaign={variant} className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 sm:py-14 flex flex-col gap-12">
      <section className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-center">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl sm:text-4xl font-semibold text-fg text-balance">
            See what happened on every paddle.
          </h1>
          <p className="text-base text-muted max-w-prose">
            {stravaOn() ? 'Upload a GPS file, bring it in from Strava, or let the tracker send it.' : 'Upload a GPS file, or let the tracker send it.'}
            You get your pace, stroke rate, efforts and rests on a map, and a short summary.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Link href="/signin?next=/paddles/new" className={buttonClass('primary')}>Add your first paddle</Link>
            <Link href="/att" className={buttonClass('secondary')}>See time trials</Link>
          </div>
        </div>

        <figure className={`${cardClass} overflow-hidden`} aria-label="A sample paddle">
          <figcaption className="px-4 pt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-base font-medium text-fg">A morning on the Thames at Reading</span>
            <span className="text-sm text-muted tabular">{fmtDay(p.paddledAt)}</span>
          </figcaption>
          <div className="px-4 pt-3">
            <SampleRoute route={p.route} />
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-hidden>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-primary-text" />Cruising</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-split" />Hard effort</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-muted" />Rest</span>
            </p>
          </div>
          <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-border">
            <Stat label="Distance" value={`${p.distanceKm.toFixed(1)} km`} />
            <Stat label="Time" value={fmtClock(p.durationS)} />
            <Stat label="Pace /500" value={p.pace} tone="primary" />
            {p.avgSR != null && <Stat label="Stroke rate" value={`${p.avgSR} spm`} tone="split" />}
          </div>
          <div className="px-4 py-4 flex flex-col gap-1.5">
            <Eyebrow>Summary</Eyebrow>
            <p className="text-base text-fg">{p.insight}</p>
          </div>
        </figure>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="whats-here">
        <h2 id="whats-here" className="text-lg font-semibold text-fg">What&apos;s here</h2>
        <ul className={`${cardClass} divide-y divide-border`}>
          {PRODUCTS.map(prod => (
            <li key={prod.name}>
              <Link href={prod.href} className="flex items-center gap-4 px-4 py-3 min-h-11 hover:bg-surface-2 transition-colors">
                <span className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="text-base font-medium text-fg sm:w-24 shrink-0">{prod.name}</span>
                  <span className="text-sm text-muted">{prod.line}</span>
                </span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
        {/* The tracker has a way in from the front door: the setup guide was
            only linked from Devices, which a new tester can't find. */}
        <p className="text-sm text-muted">
          Got a paddlesnitch tracker? <Link href="/guide" className="tt-link">Set it up</Link>.
          Tell us what you&apos;d like next with Report an issue.
        </p>
      </section>
    </div>
  )
}

// The sample route as an SVG on the server: north up, coloured by what the
// paddler was doing, green dot at the start. Data stays square.
function SampleRoute({ route }: { route: SamplePaddle['route'] }) {
  const W = 600, H = 240
  const xy = projectRoute(route.map(([lat, lng]) => ({ lat, lng })), W, H, 12)
  const runs: { kind: RouteKind; pts: [number, number][] }[] = []
  route.forEach(([, , kind], i) => {
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.pts.push(xy[i])
    else runs.push({ kind, pts: last ? [last.pts[last.pts.length - 1], xy[i]] : [xy[i]] })
  })
  const colour: Record<RouteKind, string> = { c: 'text-primary-text', s: 'text-split', r: 'text-muted' }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-bg border border-border" role="img" aria-label="Route of the sample paddle">
      {/* Cruising underneath, so the efforts and rests on an out-and-back show on top. */}
      {[...runs.filter(r => r.kind === 'c'), ...runs.filter(r => r.kind !== 'c')].map((r, i) => (
        <polyline
          key={i}
          points={r.pts.map(([x, y]) => `${x},${y}`).join(' ')}
          className={colour[r.kind]}
          fill="none" stroke="currentColor" strokeWidth={r.kind === 'c' ? 2.5 : 3.5} strokeLinejoin="round" strokeLinecap="round"
        />
      ))}
      {xy.length > 0 && <circle cx={xy[0][0]} cy={xy[0][1]} r={5} className="text-green" fill="currentColor" />}
    </svg>
  )
}
