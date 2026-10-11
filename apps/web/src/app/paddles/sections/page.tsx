'use client'
import Link from 'next/link'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'

// Your saved sections (#435): stretches you come back to, each opening every
// pass through it, yours and your buddies'.
export default function SectionsPage() {
  const q = trpc.sections.list.useQuery(undefined, { retry: false })
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← PADDLES</Link>} />
      <div className="max-w-3xl mx-auto px-4 py-6 w-full">
        <h1 className="text-lg font-bold tracking-widest">SECTIONS</h1>
        <p className="text-xs text-muted mt-1 mb-5">Stretches you saved. To save one, open a paddle, pick a section on its map, then EVERY PASS → SAVE.</p>
        {q.isPending && <p className="text-sm text-muted">Loading…</p>}
        {q.isError && <p className="text-sm text-red">Couldn’t load your sections. Please try again.</p>}
        {q.data?.length === 0 && <p className="text-sm text-muted">No sections yet.</p>}
        <div className="flex flex-col gap-2">
          {q.data?.map(s => (
            <Link key={s.id} href={`/paddles/section?id=${s.id}`} className="border border-border p-3 flex gap-3 items-center hover:bg-surface">
              <RouteThumb route={s.path} size={48} />
              <span className="flex-1 min-w-0 truncate text-sm">{s.name}</span>
              <span className="text-xs text-muted tabular">{(s.distanceMetres / 1000).toFixed(2)} km</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
