'use client'
import Link from 'next/link'
import LoadingState from '@/components/LoadingState'
import Planner from '@/components/plan/Planner'
import { Page } from '@paddlesnitch/ui/Layout'
import { EmptyState } from '@paddlesnitch/ui/Card'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { trpc } from '@/lib/trpc'

export default function SavedPlanView({ id }: { id: string }) {
  const me = trpc.me.useQuery(undefined, { retry: false })
  const q = trpc.plan.get.useQuery({ id }, { enabled: !!me.data?.user, retry: false })
  if (me.data && !me.data.user) {
    return (
      <Page width="narrow">
        <EmptyState title="Sign in to open this plan" body="Saved plans are private to the account that made them."
          action={<a className={buttonClass('primary')} href={`/signin?next=/plan/${id}`}>Sign in</a>} />
      </Page>
    )
  }
  if (q.error) return (
    <Page width="narrow">
      <EmptyState title="We can't find this plan" body="It may have been deleted."
        action={<Link className={buttonClass('primary')} href="/plan">Start a new one</Link>} />
    </Page>
  )
  if (!q.data) return <LoadingState />
  return <Planner key={`${q.data.id}-${q.data.updatedAt}`} initial={q.data} saved={q.data} />
}
