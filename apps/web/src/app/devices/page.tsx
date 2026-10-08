import { HydrationBoundary } from '@tanstack/react-query'
import { prefetch } from '@/lib/trpc-server'
import { devicesPageData } from '@/lib/device-list'
import DevicesView, { type DevicesInitial } from '@/components/devices/DevicesView'

// DEVICES, with your trackers in the first HTML (performance.md, phase 2).
// (Signed out, the proxy sends you to sign in before this runs.)
export const dynamic = 'force-dynamic'

export default async function DevicesPage() {
  const pre = await prefetch()
  let initial: DevicesInitial | undefined
  if (pre.user) {
    const userId = pre.user.id
    const [data] = await Promise.all([
      devicesPageData(userId).catch(() => undefined),
      pre.query('paddles.byRecording', undefined, c => c.paddles.byRecording()),
    ])
    initial = data
  }
  return <HydrationBoundary state={pre.state()}><DevicesView initial={initial} /></HydrationBoundary>
}
