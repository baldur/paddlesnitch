import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import PersonalHome from '@/components/PersonalHome'
import { resolveCampaign } from '@/lib/campaigns'
import { getAuthUser } from '@/lib/auth'
import { createCaller } from '@paddlesnitch/api'

export const metadata = {
  title: 'paddlesnitch.com — tools for the river',
  description: 'A growing suite of software for paddlers, rowers, and river groups.',
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
    name: 'Automated Time Trials',
    short: 'GPS-verified river racing for kayak & rowing.',
    details:
      'Organisers draw start and finish lines on a map; paddlers and rowers upload their GPS traces from any device. The system extracts the segment between the lines and ranks results, with 500 m splits, boat-class filtering, and crew listings.',
    status: 'available',
    href: '/att',
    cta: 'OPEN ATT',
  },
  {
    name: 'Paddle Analysis',
    short: 'Upload a paddle, see what actually happened.',
    details:
      'Drop a GPS trace from any device and get an instant read of the session: your pieces and rest, stroke-rate consistency, distance-per-stroke, and the day’s wind and river flow — on an interactive map coloured by speed or stroke rate.',
    status: 'available',
    href: '/analyse',
    cta: 'TRY ANALYSIS',
  },
]

// The campaign landings we can serve. `example1` reuses the default content
// with a visible marker; add genuinely different variants here as needed.
const LANDINGS: Record<'default' | 'example1', (key: string) => React.ReactNode> = {
  default: () => <LandingContent />,
  example1: () => <LandingContent variant="example1" />,
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string | string[] }>
}) {
  // Signed in → the personal paddle dashboard (their stuff, not marketing).
  // Signed out → the marketing landing, tailored by any ?campaign= variant.
  const user = await getAuthUser()
  if (user) {
    // SSR via the tRPC router in-process (no HTTP hop) — same procedure the
    // browser + mobile call over the wire.
    const { cards } = await createCaller({ user }).paddles.list()
    return (
      <main className="flex-1 flex flex-col">
        <AppHeader breadcrumb={<span className="text-muted text-xs tracking-widest hidden sm:inline">TOOLS FOR THE RIVER</span>} />
        <PersonalHome name={user.displayName} cards={cards} />
      </main>
    )
  }

  const { campaign } = await searchParams
  const r = resolveCampaign(campaign)
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
      <section className="border-b border-border px-4 py-8 md:py-14 text-center bg-surface">
        {variant && (
          // Campaign marker — shows this landing came from a tailored source
          // rather than the default front door.
          <p
            data-campaign={variant}
            className="text-primary text-[10px] tracking-[0.3em] uppercase mb-2"
          >
            campaign: {variant}
          </p>
        )}
        <p className="text-muted text-[10px] md:text-xs tracking-[0.3em] uppercase mb-2">
          A growing suite
        </p>
        <h1 className="text-2xl md:text-5xl font-bold text-fg mb-2">
          Software for paddlers, rowers, and river groups.
        </h1>
        <p className="text-muted text-sm max-w-xl mx-auto leading-relaxed hidden sm:block">
          Practical tools that disappear into the river day. Honest, no-bloat,
          designed for people who&apos;d rather be on the water.
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
          More tools are on the way. Use the &quot;Report an issue&quot; widget below
          to tell us what you&apos;d like to see.
        </p>
      </section>
    </>
  )
}
