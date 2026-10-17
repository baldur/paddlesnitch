'use client'
import Link from 'next/link'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Chevron, EmptyState, cardLinkClass } from '@paddlesnitch/ui/Card'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'

// Your saved sections (#435): stretches you come back to, each opening every
// pass through it, yours and your buddies'.
export default function SectionsPage() {
  const q = trpc.sections.list.useQuery(undefined, { retry: false })
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← Paddles</Link>} />
      <Page>
        <PageHeader title="Sections" description="Stretches you come back to. Each one opens every pass through it, yours and your buddies'." />
        {q.isPending && <LoadingState label="Loading" className="py-10" />}
        {q.isError && <p className="text-base text-red" role="alert">Couldn’t load your sections. Please try again.</p>}
        {/* The way to make one starts on a paddle: open it, pick a section on
            its map, then save it from Every pass. */}
        {q.data?.length === 0 && (
          <EmptyState title="No sections yet" body="Open a paddle and tap Pick a section on its map. Save it from Every pass to keep it here."
            action={<Link href="/paddles" className={buttonClass('primary')}>Choose a paddle</Link>} />
        )}
        {!!q.data?.length && (
          <ul className="flex flex-col gap-2">
            {q.data.map(s => (
              <li key={s.id}>
                <Link href={`/paddles/section?id=${s.id}`} className={`${cardLinkClass} p-3 flex gap-3 items-center`}>
                  <RouteThumb route={s.path} size={48} />
                  <span className="flex-1 min-w-0 truncate text-base text-fg">{s.name}</span>
                  <span className="text-sm text-muted tabular">{(s.distanceMetres / 1000).toFixed(2)} km</span>
                  <Chevron />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </main>
  )
}
