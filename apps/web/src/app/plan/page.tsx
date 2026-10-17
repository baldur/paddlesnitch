import { HydrationBoundary } from '@tanstack/react-query'
import AppHeader from '@/components/AppHeader'
import Planner from '@/components/plan/Planner'
import { draftFromParams, lockFromParams } from '@/lib/plan-ui'
import { prefetch } from '@/lib/trpc-server'

// PLAN: a new plan. Anyone can plan; the address bar carries an unsaved one
// (?from=…&to=…), so a link, a reload or signing in to save keeps it.
export const dynamic = 'force-dynamic'

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const { draft, view } = draftFromParams(sp)
  const lock = lockFromParams(sp)
  const pre = await prefetch()
  if (pre.user) await pre.query('plan.list', undefined, c => c.plan.list())
  return (
    <HydrationBoundary state={pre.state()}>
      <AppHeader />
      <Planner initial={draft} view={view} lock={lock} />
    </HydrationBoundary>
  )
}
