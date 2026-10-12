import Link from 'next/link'
import { HydrationBoundary } from '@tanstack/react-query'
import AppHeader from '@/components/AppHeader'
import SharedPlanView from '@/components/plan/SharedPlanView'
import { prefetch } from '@/lib/trpc-server'

// A plan someone shared: anyone with the link may view it, signed in or not.
export const dynamic = 'force-dynamic'

export default async function SharedPlanPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params
  const pre = await prefetch()
  await pre.query('plan.shared', { shareId }, c => c.plan.shared({ shareId }))
  return (
    <HydrationBoundary state={pre.state()}>
      <AppHeader breadcrumb={<Link href="/plan" className="hover:text-fg">PLAN</Link>} />
      <SharedPlanView shareId={shareId} />
    </HydrationBoundary>
  )
}
