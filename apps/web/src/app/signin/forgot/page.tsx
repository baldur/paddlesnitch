'use client'
import Link from 'next/link'
import { RESET_EMAIL } from '@/lib/email-delivery'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMountedAt } from '@/lib/use-mounted-at'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { buttonClass } from '@paddlesnitch/ui/Button'
import NoEmailReset from '../NoEmailReset'

// Step 1 of password reset: user types their email, we ask Cognito to send a
// code. We always show the same "code sent" message regardless of whether the
// email exists in the pool — don't leak account existence here.
export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Anti-bot fields for the reset-code request (which sends an email): a
  // honeypot the user never sees, and elapsed time since the page loaded.
  const [website, setWebsite] = useState('')
  const mountedAt = useMountedAt()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, elapsedMs: Date.now() - mountedAt.current }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Couldn’t send the reset code. Please try again.')
      }
      // Send them to the next step regardless of whether the email exists —
      // the next page accepts the code and shows the same UX either way.
      router.push(`/signin/reset?email=${encodeURIComponent(email)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send the reset code. Please try again.')
      setLoading(false)
    }
  }

  // We can't email a reset code to most people yet (lib/email-delivery.ts):
  // say so plainly and offer the way that works, instead of sending a code
  // that never arrives.
  if (!RESET_EMAIL) return <NoEmailReset />

  return (
    <Page width="narrow" className="max-w-md">
      <PageHeader title="Reset your password" description="Enter your email and we'll send you a 6-digit code." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Honeypot — visually hidden, skipped by keyboard + screen readers.
            Real users never see or fill this; bots scraping inputs will. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            Website
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={e => setWebsite(e.target.value)}
            />
          </label>
        </div>
        <Field label="Email" htmlFor="forgot-email">
          <input
            id="forgot-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
        )}
        <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full')}>
          {loading ? 'Sending…' : 'Send code'}
        </button>
        <p className="text-sm text-muted text-center">
          Remembered it? <Link href="/signin" className="tt-link">Sign in</Link>
        </p>
      </form>
    </Page>
  )
}
