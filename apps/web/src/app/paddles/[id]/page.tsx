import { HydrationBoundary } from '@tanstack/react-query'
import { prefetch } from '@/lib/trpc-server'
import SavedPaddle from '@/components/paddles/SavedPaddle'

// One paddle, with the paddle in the first HTML (performance.md, phase 2).
// A paddle that isn't the viewer's isn't prefilled; the client says it can't
// find it, as before.
export const dynamic = 'force-dynamic'

export default async function SavedPaddlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const pre = await prefetch()
  if (pre.user) await pre.query('paddles.get', { id }, c => c.paddles.get({ id }))
  return <HydrationBoundary state={pre.state()}><SavedPaddle id={id} /></HydrationBoundary>
}
