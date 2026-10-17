import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'

export const metadata = { title: 'Page not found' }

// Shown for any unknown URL and wherever a page calls notFound() — including
// private trials and profiles, which answer "not found" so they don't leak.
// Without it Next showed its own white page inside the dark site.
export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <Page width="narrow">
        <PageHeader
          eyebrow="404"
          title="We can't find that page"
          description={<>The link may be old, or the page may be private. If someone shared it with you, check you&apos;re signed in with the right account.</>}
        />
        <div className="flex flex-wrap gap-2">
          <Link href="/" className={buttonClass('primary')}>Go to the home page</Link>
          <Link href="/paddles" className={buttonClass('secondary')}>Paddles</Link>
          <Link href="/att" className={buttonClass('secondary')}>Trials</Link>
        </div>
      </Page>
    </main>
  )
}
