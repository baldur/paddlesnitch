import Link from 'next/link'
import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import { PHOTO_CREDIT } from '@/lib/plan-ui'

// Where the river planner's data comes from, under what licence, and how we
// fetch it. The weekly refresh's User-Agent points here, so a data provider who
// sees us in their logs can find out who we are.
export const metadata: Metadata = {
  title: 'Data sources',
  description: 'Where the river planner’s data comes from, its licences, and how we fetch it.',
}

const OURS = new Set(['contribution', 'curated'])

export default function SourcesPage() {
  const ids = (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).filter(id => !OURS.has(id))
  return (
    <>
      <AppHeader breadcrumb={<Link href="/plan" className="tt-nav-link text-sm">← Plan</Link>} />
      <main className="max-w-3xl mx-auto px-4 py-8 text-fg">
        <h1 className="text-2xl font-semibold">Data sources</h1>
        <p className="mt-3 text-muted">
          The river planner is built from open data. Once a week our server downloads each source below, keyless and
          as one copy of the whole national set, never per user. It identifies itself as <code>paddlesnitch-river-planner</code> and
          links here. Live river levels are read the same way, every 15 minutes. Questions or a request to stop:{' '}
          <a className="tt-link" href="mailto:privacy@paddlesnitch.com">privacy@paddlesnitch.com</a>.
        </p>

        <h2 className="mt-8 text-lg font-semibold">Waterways, locks, weirs, access and levels</h2>
        <ul className="mt-3 space-y-3" data-testid="sources">
          {ids.map(id => (
            <li key={id}>
              <a className="tt-link" href={SOURCES[id].url} target="_blank" rel="noreferrer">{SOURCES[id].name}</a>
              <div className="text-sm text-muted">{SOURCES[id].licence} · {SOURCES[id].attribution}</div>
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-lg font-semibold">Aerial photos</h2>
        <p className="mt-2 text-sm text-muted">
          On the satellite view and behind printed lock drawings, where the government publishes them openly. Elsewhere the
          satellite view shows Esri imagery, on screen only: it isn’t printed or stored.
        </p>
        <ul className="mt-3 space-y-1 text-sm" data-testid="photos">
          {Object.values(PHOTO_CREDIT).map(c => <li key={c}>{c}</li>)}
        </ul>

        <h2 className="mt-8 text-lg font-semibold">What paddlers add</h2>
        <p className="mt-2 text-sm text-muted">
          Portage details shared by paddlers are public under CC0 and downloadable as{' '}
          <Link className="tt-link" href="/plan/data/live/openportage" prefetch={false}>OpenPortage</Link>. They are never mixed with the
          OpenStreetMap (ODbL) or share-alike data above.
        </p>
      </main>
    </>
  )
}
