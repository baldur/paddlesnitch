import Link from 'next/link'
import AppHeader from '@/components/AppHeader'

export const metadata = { title: 'Page not found' }

// Shown for any unknown URL and wherever a page calls notFound() — including
// private trials and profiles, which answer "not found" so they don't leak.
// Without it Next showed its own white page inside the dark site.
export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <div className="flex-1 px-4 py-16 max-w-xl mx-auto w-full flex flex-col gap-4">
        <p className="text-xs text-muted tracking-widest">404</p>
        <h1 className="text-lg font-bold text-balance">We can&apos;t find that page</h1>
        <p className="text-sm text-muted leading-relaxed">
          The link may be old, or the page may be private. If someone shared it with you, check
          you&apos;re signed in with the right account.
        </p>
        <div className="flex flex-wrap gap-3 mt-2">
          <Link href="/" className="px-4 py-3 bg-primary text-white text-sm font-bold">Go to the home page</Link>
          <Link href="/paddles" className="px-4 py-3 border border-border text-fg text-sm">Your paddles</Link>
          <Link href="/att" className="px-4 py-3 border border-border text-fg text-sm">Trials</Link>
        </div>
      </div>
    </main>
  )
}
