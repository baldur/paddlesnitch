import Link from 'next/link'
import { HydrationBoundary } from '@tanstack/react-query'
import AppHeader from '@/components/AppHeader'
import SharedPlanView from '@/components/plan/SharedPlanView'
import { prefetch } from '@/lib/trpc-server'
import type { Metadata } from 'next'
import { loadNational } from '@paddlesnitch/waterways/national'
import { routePlan } from '@paddlesnitch/waterways/plan'
import { getSharedPlan } from '@paddlesnitch/waterways/plan-store'
import { planSummaryText } from '@/lib/plan-ui'

// A plan someone shared: anyone with the link may view it, signed in or not.
export const dynamic = 'force-dynamic'

// Title and a one-line summary for link previews and assistants (#513). The
// route is worked out only if it's quick: on a cold instance the dataset
// load would hold the page, so after SUMMARY_MS it falls back to the shape.
const SUMMARY_MS = 1500

export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params
  const found = /^[A-Za-z0-9_-]{1,64}$/.test(shareId) ? await getSharedPlan(shareId).catch(() => null) : null
  if (!found) return { title: 'Shared plan' }
  const { plan } = found
  const routed = await Promise.race([
    loadNational().then(ds => routePlan(ds, plan)).catch(() => null),
    new Promise<null>(r => setTimeout(() => r(null), SUMMARY_MS)),
  ])
  const description = routed && typeof routed !== 'string'
    ? `${planSummaryText(routed, plan.shape)}. A paddle plan on paddlesnitch.`
    : `A ${plan.shape === 'return' ? 'return' : 'one-way'} paddle plan on paddlesnitch.`
  return { title: plan.title, description, openGraph: { title: plan.title, description } }
}

export default async function SharedPlanPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params
  const pre = await prefetch()
  await pre.query('plan.shared', { shareId }, c => c.plan.shared({ shareId }))
  return (
    <HydrationBoundary state={pre.state()}>
      <AppHeader breadcrumb={<Link href="/plan" className="tt-nav-link text-sm">← Plan</Link>} />
      <SharedPlanView shareId={shareId} />
    </HydrationBoundary>
  )
}
