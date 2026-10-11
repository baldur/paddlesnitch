'use client'
import Link from 'next/link'
import LoadingState from '@/components/LoadingState'
import Planner from '@/components/plan/Planner'
import { trpc } from '@/lib/trpc'

export default function SavedPlanView({ id }: { id: string }) {
  const me = trpc.me.useQuery(undefined, { retry: false })
  const q = trpc.plan.get.useQuery({ id }, { enabled: !!me.data?.user, retry: false })
  if (me.data && !me.data.user) {
    return <p className="p-6 text-sm text-muted"><a className="underline hover:text-fg" href={`/signin?next=/plan/${id}`}>Sign in</a> to open this plan.</p>
  }
  if (q.error) return <p className="p-6 text-sm text-muted">We can&apos;t find this plan. <Link className="underline hover:text-fg" href="/plan">Start a new one</Link>.</p>
  if (!q.data) return <LoadingState />
  return <Planner key={`${q.data.id}-${q.data.updatedAt}`} initial={q.data} saved={q.data} />
}
