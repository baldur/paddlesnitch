import Link from 'next/link'
import { HydrationBoundary } from '@tanstack/react-query'
import AppHeader from '@/components/AppHeader'
import SavedPlanView from '@/components/plan/SavedPlanView'
import { prefetch } from '@/lib/trpc-server'

// One saved plan, private to its owner, with the plan in the first HTML.
export const dynamic = 'force-dynamic'

export default async function SavedPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const pre = await prefetch()
  if (pre.user) await pre.query('plan.get', { id }, c => c.plan.get({ id }))
  return (
    <HydrationBoundary state={pre.state()}>
      <AppHeader breadcrumb={<Link href="/plan" className="tt-nav-link text-sm">← Plan</Link>} />
      <SavedPlanView id={id} />
    </HydrationBoundary>
  )
}
