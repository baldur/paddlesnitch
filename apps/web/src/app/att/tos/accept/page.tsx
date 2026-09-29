'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { CURRENT_TOS_VERSION } from '@/lib/types'

// Accept the current Terms, then carry on. Reached after signing in when the
// account hasn't accepted them: an email-code or Strava sign-up (only the
// password sign-up form had the Terms box), or an account from before this
// version (audit decision 2026-09).

// Only a path on this site: `next` comes from the URL.
const onSite = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/')

function Accept() {
  const router = useRouter()
  const next = onSite(useSearchParams().get('next'))
  const [ready, setReady] = useState(false)
  const [ticked, setTicked] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/account/tos').then(async r => {
      if (r.status === 401) return router.replace(`/att/auth?next=${encodeURIComponent(`/att/tos/accept?next=${encodeURIComponent(next)}`)}`)
      const body = await r.json().catch(() => ({}))
      if (body?.accepted) return router.replace(next)
      setReady(true)
    }).catch(() => setReady(true))
  }, [next, router])

  async function accept(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const r = await fetch('/api/account/tos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: CURRENT_TOS_VERSION }),
    }).catch(() => null)
    if (r?.ok) router.replace(next)
    else setError('Couldn’t save that. Please try again.')
  }

  if (!ready) return <p className="text-sm text-muted">Loading…</p>
  return (
    <form onSubmit={accept} className="border border-border bg-surface p-6 flex flex-col gap-4 max-w-md w-full">
      <h1 className="text-lg font-bold text-fg tracking-widest">TERMS OF SERVICE</h1>
      <p className="text-sm text-muted leading-relaxed">
        Before you carry on, please read and agree to our Terms of Service and Privacy Policy. They
        say what we do with your paddles and results, and what you agree to when you use the site.
      </p>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} className="mt-0.5 accent-primary" />
        <span>
          I have read and agree to the{' '}
          <Link href="/att/tos" target="_blank" className="tt-link">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/att/privacy" target="_blank" className="tt-link">Privacy Policy</Link>.
        </span>
      </label>
      {error && <p className="border border-red bg-red/10 px-3 py-2 text-red text-xs" role="alert">{error}</p>}
      <button type="submit" disabled={!ticked} className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:opacity-90 disabled:opacity-50 transition-opacity">
        CONTINUE
      </button>
    </form>
  )
}

export default function AcceptTermsPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <div className="flex-1 flex items-start justify-center pt-16 px-4">
        <Suspense>
          <Accept />
        </Suspense>
      </div>
    </main>
  )
}
