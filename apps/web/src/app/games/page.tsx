import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { cardLinkClass, Chevron } from '@paddlesnitch/ui/Card'
import { GAMES } from '@/lib/games'

// The games index. The games themselves are static files served from S3 under
// /games/<slug>/ (see games/CLAUDE.md), not Next pages, so they're linked with
// a plain <a>: next/link would try to route to them client-side.
export const metadata = { title: 'Games' }

export default function GamesPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/" className="tt-nav-link text-sm">← Home</Link>} />

      <Page>
        <PageHeader title="Games" description="Paddling games that run in your browser, on a computer or a phone." />

        <nav aria-label="Games" className="grid gap-2 sm:grid-cols-2">
          {GAMES.map(game => (
            <a key={game.slug} href={game.href} className={`${cardLinkClass} px-4 py-3 flex items-center gap-3`}>
              <span className="flex-1 min-w-0">
                <span className="block text-base font-medium text-fg">{game.title}</span>
                <span className="block text-sm text-muted">{game.blurb}</span>
              </span>
              <Chevron />
            </a>
          ))}
        </nav>
      </Page>
    </main>
  )
}
