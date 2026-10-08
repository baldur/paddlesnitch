import { HydrationBoundary } from '@tanstack/react-query'
import { prefetch } from '@/lib/trpc-server'
import PaddlesList from '@/components/paddles/PaddlesList'

// PADDLES, with the list in the first HTML (performance.md, phase 2).
export const dynamic = 'force-dynamic'

export default async function PaddlesPage() {
  const pre = await prefetch()
  if (pre.user) await pre.query('paddles.sessions', undefined, c => c.paddles.sessions())
  return <HydrationBoundary state={pre.state()}><PaddlesList /></HydrationBoundary>
}
