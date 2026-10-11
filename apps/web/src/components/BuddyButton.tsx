'use client'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

// On someone's profile: ask them to be your buddy, or where you stand with them
// (docs/features/buddies-and-compare.md). Shown to signed-in viewers only.
export default function BuddyButton({ userId }: { userId: string }) {
  const utils = trpc.useUtils()
  const status = trpc.buddies.status.useQuery({ userId }, { retry: false })
  const done = () => { utils.buddies.status.invalidate({ userId }); utils.buddies.pendingCount.invalidate() }
  const request = trpc.buddies.request.useMutation({ onSuccess: done })
  const accept = trpc.buddies.accept.useMutation({ onSuccess: done })
  const btn = 'text-xs tracking-widest px-3 py-1.5 border disabled:opacity-40'

  if (!status.data || status.data === 'self') return null
  if (status.data === 'buddies') return <Link href="/buddies" className="text-xs tracking-widest text-green">BUDDIES ✓</Link>
  if (status.data === 'asked') return <span className="text-xs tracking-widest text-muted">REQUEST SENT</span>
  if (status.data === 'asked_you') return (
    <button type="button" className={`${btn} bg-primary text-white border-primary`} disabled={accept.isPending} onClick={() => accept.mutate({ userId })}>ACCEPT BUDDY</button>
  )
  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" className={`${btn} border-primary text-primary`} disabled={request.isPending} onClick={() => request.mutate({ userId })}>
        {request.isPending ? 'ASKING…' : 'ADD AS BUDDY'}
      </button>
      {request.error && <span className="text-xs text-red">{request.error.data?.code === 'TOO_MANY_REQUESTS' ? request.error.message : "Couldn't send the request. Please try again."}</span>}
    </span>
  )
}
