'use client'
import Link from 'next/link'
import LoadingState from '@/components/LoadingState'
import Planner from '@/components/plan/Planner'
import { trpc } from '@/lib/trpc'

export default function SharedPlanView({ shareId }: { shareId: string }) {
  const q = trpc.plan.shared.useQuery({ shareId }, { retry: false })
  if (q.error) return <p className="p-6 text-sm text-muted">We can&apos;t find this plan. It may no longer be shared. <Link className="underline hover:text-fg" href="/plan">Plan your own</Link>.</p>
  if (!q.data) return <LoadingState />
  const { plan, owner, mine } = q.data
  return <Planner initial={plan} shared={{ owner, mine, planId: plan.id }} />
}
