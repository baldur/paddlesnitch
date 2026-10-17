'use client'
import Link from 'next/link'
import LoadingState from '@/components/LoadingState'
import Planner from '@/components/plan/Planner'
import { Page } from '@paddlesnitch/ui/Layout'
import { EmptyState } from '@paddlesnitch/ui/Card'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { trpc } from '@/lib/trpc'

export default function SharedPlanView({ shareId }: { shareId: string }) {
  const q = trpc.plan.shared.useQuery({ shareId }, { retry: false })
  if (q.error) return (
    <Page width="narrow">
      <EmptyState title="We can't find this plan" body="It may no longer be shared."
        action={<Link className={buttonClass('primary')} href="/plan">Plan your own</Link>} />
    </Page>
  )
  if (!q.data) return <LoadingState />
  const { plan, owner, mine } = q.data
  return <Planner initial={plan} shared={{ owner, mine, planId: plan.id }} />
}
