'use client'
import Link from 'next/link'
import { EMAIL_DELIVERY } from '@/lib/email-delivery'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMountedAt } from '@/lib/use-mounted-at'

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

  const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'

  // We can't email a reset code to most people yet (lib/email-delivery.ts):
  // say what to do instead of sending a code that never arrives.
  if (!EMAIL_DELIVERY) return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-4 py-3">
        <Link href="/">
          <span className="text-fg font-bold text-lg tracking-widest">paddlesnitch</span>
        </Link>
      </header>
      <div className="flex-1 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-sm flex flex-col gap-4">
          <h1 className="text-sm tracking-widest text-fg">RESET PASSWORD</h1>
          <p className="text-sm text-muted leading-relaxed">
            We can&apos;t email reset codes yet. Tell us with <strong className="text-fg">Report an issue</strong>,
            with the email you signed up with, and we&apos;ll reset your password for you.
          </p>
          <p className="text-sm text-muted leading-relaxed">If you connected Strava, you can sign in with Strava instead.</p>
          <Link href="/signin" className="tt-link text-sm">← Back to sign in</Link>
        </div>
      </div>
    </main>
  )

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-4 py-3">
        <Link href="/">
          <span className="text-fg font-bold text-lg tracking-widest">paddlesnitch</span>
        </Link>
      </header>
      <div className="flex-1 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-sm">
          <h1 className="text-sm tracking-widest text-fg mb-2">RESET PASSWORD</h1>
          <p className="text-xs text-muted mb-6">
            Enter your email and we&apos;ll send you a 6-digit code to reset your
            password.
          </p>
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
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted tracking-widest">EMAIL</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && (
              <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 transition-colors"
            >
              {loading ? 'SENDING…' : 'SEND CODE'}
            </button>
            <p className="text-xs text-muted text-center">
              Remembered it?{' '}
              <Link href="/signin" className="tt-link">Sign in</Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  )
}
