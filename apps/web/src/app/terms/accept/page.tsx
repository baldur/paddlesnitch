'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'

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
      if (r.status === 401) return router.replace(`/signin?next=${encodeURIComponent(`/terms/accept?next=${encodeURIComponent(next)}`)}`)
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

  if (!ready) return <p className="text-base text-muted">Loading…</p>
  return (
    <>
      <PageHeader
        title="Terms of Service"
        description="Before you carry on, please read and agree to our Terms of Service and Privacy Policy. They say what we do with your paddles and results, and what you agree to when you use the site."
      />
      <form onSubmit={accept} className="flex flex-col gap-4">
        <label className="flex items-start gap-3 text-base text-muted min-h-11 py-1">
          <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} className="mt-1 w-5 h-5 shrink-0 accent-primary" />
          <span>
            I have read and agree to the{' '}
            <Link href="/terms" target="_blank" className="tt-link">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" target="_blank" className="tt-link">Privacy Policy</Link>.
          </span>
        </label>
        {error && <p className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-sm text-red" role="alert">{error}</p>}
        <div>
          <button type="submit" disabled={!ticked} className={buttonClass('primary')}>
            Continue
          </button>
        </div>
      </form>
    </>
  )
}

export default function AcceptTermsPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <Page width="narrow">
        <Suspense>
          <Accept />
        </Suspense>
      </Page>
    </main>
  )
}
