import { HydrationBoundary } from '@tanstack/react-query'
import AppHeader from '@/components/AppHeader'
import Planner from '@/components/plan/Planner'
import { resolveEnd } from '@paddlesnitch/waterways/find'
import { loadNational } from '@paddlesnitch/waterways/national'
import { draftFromParams, lockFromParams } from '@/lib/plan-ui'
import { prefetch } from '@/lib/trpc-server'

// PLAN: a new plan. Anyone can plan; the address bar carries an unsaved one
// (?from=…&to=…), so a link, a reload or signing in to save keeps it. A link
// may name its ends instead (?from=cropredy-lock, #508) and keep them to one
// waterway (&waterway=oxford-canal); the planner then rewrites the address bar
// as lat,lng, so a shared link stays stable.
export const dynamic = 'force-dynamic'

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const { draft, view } = draftFromParams(sp)
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined }
  const from = one('from'), to = one('to'), waterway = one('waterway')?.replace(/-/g, ' ')
  const unfound: { end: 'start' | 'finish'; name: string }[] = []
  if ((from && !draft.start) || (to && !draft.finish) || waterway) {
    const ds = await loadNational()
    const end = (v: string, near?: [number, number]) => resolveEnd(ds, v, { waterway, near }) ?? (waterway ? resolveEnd(ds, v, { near }) : null)
    if (from) { draft.start = end(from); if (!draft.start) unfound.push({ end: 'start', name: from }) }
    if (to) { draft.finish = end(to, draft.start ?? undefined); if (!draft.finish) unfound.push({ end: 'finish', name: to }) }
  }
  const lock = lockFromParams(sp)
  const pre = await prefetch()
  if (pre.user) await pre.query('plan.list', undefined, c => c.plan.list())
  return (
    <HydrationBoundary state={pre.state()}>
      <AppHeader />
      <Planner initial={draft} view={view} lock={lock} unfound={unfound} />
    </HydrationBoundary>
  )
}
