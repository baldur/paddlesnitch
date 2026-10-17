'use client'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { badgeClass } from '@paddlesnitch/ui/Card'

// On someone's profile: ask them to be your buddy, or where you stand with them
// (docs/features/buddies-and-compare.md). Shown to signed-in viewers only.
export default function BuddyButton({ userId }: { userId: string }) {
  const utils = trpc.useUtils()
  const status = trpc.buddies.status.useQuery({ userId }, { retry: false })
  const done = () => { utils.buddies.status.invalidate({ userId }); utils.buddies.pendingCount.invalidate() }
  const request = trpc.buddies.request.useMutation({ onSuccess: done })
  const accept = trpc.buddies.accept.useMutation({ onSuccess: done })

  if (!status.data || status.data === 'self') return null
  if (status.data === 'buddies') return <Link href="/buddies" className={badgeClass('green')}>Buddies</Link>
  if (status.data === 'asked') return <span className={badgeClass('neutral')}>Request sent</span>
  if (status.data === 'asked_you') return (
    <button type="button" className={buttonClass('primary', 'sm')} disabled={accept.isPending} onClick={() => accept.mutate({ userId })}>Accept buddy</button>
  )
  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" className={buttonClass('secondary', 'sm')} disabled={request.isPending} onClick={() => request.mutate({ userId })}>
        {request.isPending ? 'Adding…' : 'Add as buddy'}
      </button>
      {request.error && <span className="text-sm text-red" role="alert">{request.error.data?.code === 'TOO_MANY_REQUESTS' ? request.error.message : "Couldn't send the request. Please try again."}</span>}
    </span>
  )
}
