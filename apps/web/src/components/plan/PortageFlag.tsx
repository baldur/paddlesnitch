'use client'
import { useState } from 'react'
import { trpc } from '@/lib/trpc'

// Report a paddler's portage details from its own page: the same flag as on a
// plan's stop list, and signing in comes back here.
export default function PortageFlag({ id, here }: { id: string; here: string }) {
  const me = trpc.me.useQuery(undefined, { retry: false })
  const [flagged, setFlagged] = useState(false)
  const flag = trpc.portage.flag.useMutation({ onSuccess: () => setFlagged(true) })
  if (flagged) return <span className="text-muted no-print"> · flagged, thanks</span>
  if (!me.data?.user) {
    return <> · <a className="underline hover:text-fg no-print" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in to flag as wrong</a></>
  }
  return <> · <button type="button" className="underline hover:text-fg no-print" onClick={() => flag.mutate({ id })}>flag as wrong</button></>
}
