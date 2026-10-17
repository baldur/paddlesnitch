import Link from 'next/link'

// Sign-in is the whole site's, not Trials' (it lived at /att/auth until the
// 2026-10 site review); its pages are client components, so the title is here.
// The site header (tabs, account menu) is left out on these pages; a plain
// wordmark takes you home.
export const metadata = { title: 'Sign in' }

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-4 min-h-14 flex items-center">
        <Link href="/" className="font-mono font-bold tracking-wider text-fg">paddlesnitch</Link>
      </header>
      {children}
    </main>
  )
}
