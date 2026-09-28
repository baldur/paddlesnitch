import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import type { Metadata } from 'next'
import BetaTestersLanding from '@/components/campaigns/BetaTestersLanding'
import { resolveCampaign, type CampaignLanding } from '@/lib/campaigns'
import { getAuthUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

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

// The available products. Add a `{ status: 'coming-soon' }` entry to show an
// anonymous teaser slot, or a full entry (name/short/details/href/cta,
// status 'available') to list a real product.
type Product = {
  name?: string
  short?: string                             // one-line subtitle
  details?: string                           // 1-2 sentences expanding it
  status: 'available' | 'coming-soon'
  href?: string                              // only when available
  cta?: string                               // CTA button text
}

const PRODUCTS: Product[] = [
  {
    name: 'Time trials',
    short: 'Race a course, timed from your GPS file.',
    details:
      'Organisers draw start and finish lines on a map. You upload your GPS file and get your time, 500 m splits and a place on the leaderboard.',
    status: 'available',
    href: '/att',
    cta: 'OPEN TRIALS',
  },
  {
    name: 'Paddles',
    short: 'See what happened on every paddle.',
    details:
      'Upload a GPS file, or bring one in from Strava or the tracker. See your speed, stroke rate, efforts and rests, and the wind and river flow that day, on a map.',
    status: 'available',
    href: '/paddles',
    cta: 'OPEN PADDLES',
  },
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
      <AppHeader breadcrumb={<span className="text-muted text-xs tracking-widest hidden sm:inline">TOOLS FOR THE RIVER</span>} />
      {render(r.landing)}
    </main>
  )
}

// The page body, split out so it can be rendered in a test without the
// client-only AppShell header. Kept deliberately compact on mobile
// (#210): a short hero and one-line product cards so both products sit
// above the fold on a phone; the marketing paragraphs only appear from
// `sm:` up.
export function LandingContent({ variant }: { variant?: string } = {}) {
  return (
    <>
      {/* A campaign landing is marked in the markup (for tests and analytics),
          never in text a visitor can see. */}
      <section data-campaign={variant} className="border-b border-border px-4 py-8 md:py-14 text-center bg-surface">
        <h1 className="text-2xl md:text-5xl font-bold text-fg mb-2">
          Tools for paddlers and rowers.
        </h1>
        <p className="text-muted text-sm max-w-xl mx-auto leading-relaxed hidden sm:block">
          Time your races from a GPS file, and see what happened on every paddle.
        </p>
      </section>

      <section className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full">
        <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-4">
          Products
        </h2>
        <div className="flex flex-col gap-4">
          {PRODUCTS.map((p, i) => {
            if (p.status === 'coming-soon') {
              return (
                <article
                  key={`teaser-${i}`}
                  className="border border-dashed border-border bg-surface p-6 flex items-center justify-end h-24"
                  aria-label="Coming soon"
                >
                  <span className="text-[10px] tracking-widest px-2 py-0.5 border border-muted text-muted whitespace-nowrap">
                    COMING SOON
                  </span>
                </article>
              )
            }
            return (
              <article
                key={p.name}
                className="border border-border p-5 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-lg font-bold text-fg">{p.name}</h3>
                  <span className="text-[10px] tracking-widest px-2 py-0.5 border border-green text-green whitespace-nowrap shrink-0">
                    AVAILABLE NOW
                  </span>
                </div>
                <p className="text-sm text-fg">{p.short}</p>
                <p className="text-sm text-muted leading-relaxed hidden sm:block">
                  {p.details}
                </p>
                {p.href && p.cta && (
                  <Link
                    href={p.href}
                    className="self-start mt-2 px-4 py-2 bg-primary text-white text-xs tracking-widest hover:bg-primary transition-colors"
                  >
                    {p.cta}
                  </Link>
                )}
              </article>
            )
          })}
        </div>

        <p className="text-xs text-muted text-center mt-10">
          Tell us what you&apos;d like next with Report an issue.
        </p>
      </section>
    </>
  )
}
