'use client'
import Link from 'next/link'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import StravaButton from '@/components/strava/StravaButton'

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/att'

  // Redirect if already signed in
  useEffect(() => {
    fetch('/att/api/auth/me').then(r => {
      if (r.ok) router.replace(next)
    })
  }, [next, router])

  const [tab, setTab] = useState<'signin' | 'signup' | 'code'>('signin')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  // ToS acceptance is mandatory on signup; the checkbox lives just above
  // the submit button. The version sent on POST is hard-coded to '001'
  // for now — when CURRENT_TOS_VERSION bumps, this string bumps with it.
  const [tosAccepted, setTosAccepted] = useState(false)
  // ?error= comes back from server-driven flows (Strava OAuth callback,
  // legacy magic-link). Map known keys to user-friendly messages once.
  const initialError = (() => {
    const e = searchParams.get('error')
    if (e === 'magic_disabled') return 'Magic link sign-in is temporarily unavailable. Please use email and password.'
    if (e === 'strava_denied') return 'You cancelled the Strava sign-in.'
    if (e === 'strava_state_mismatch') return 'Strava sign-in failed (state mismatch). Please try again.'
    if (e === 'strava_exchange_failed') return 'Strava sign-in failed during token exchange. Please try again.'
    if (e === 'strava_profile_failed') return 'Could not load your Strava profile. Please try again.'
    // strava_no_email was retired — Strava never shares email with
    // third-party apps, so we now synthesise a placeholder address at
    // sign-in. See src/app/att/api/auth/strava/callback/route.ts.
    if (e === 'strava_user_create_failed') return 'Could not create an account from your Strava profile. Please try email sign-up.'
    if (e === 'strava_signin_failed') return 'Could not complete Strava sign-in. Please try again.'
    if (e === 'strava_not_configured') return 'Strava sign-in is not configured on this server.'
    return ''
  })()
  const [error, setError] = useState(initialError)
  const [loading, setLoading] = useState(false)
  // OTP flow state. `session` is non-empty once the user has requested a code
  // and we're waiting for them to type it in.
  const [otpSession, setOtpSession] = useState('')
  const [otpCode, setOtpCode] = useState('')
  // Anti-bot fields for the passwordless code request (which sends an email):
  // a honeypot the user never sees, and the elapsed time since the page loaded.
  const [website, setWebsite] = useState('')
  const mountedAt = useRef(Date.now())

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        router.push(next)
      } else {
        const data = await res.json()
        setError(data.error ?? 'Sign in failed')
        setLoading(false)
      }
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!tosAccepted) {
      setError('You must agree to the Terms of Service to create an account.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName, password, acceptedTosVersion: '001' }),
      })
      if (res.ok) {
        router.push(next)
      } else {
        const data = await res.json()
        setError(data.error ?? 'Sign up failed')
        setLoading(false)
      }
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }

  const handleOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/otp-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, elapsedMs: Date.now() - mountedAt.current }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not send code')
      setOtpSession(data.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code')
    } finally {
      setLoading(false)
    }
  }

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, session: otpSession, code: otpCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Server returns a new session on retryable failures; swap it in
        // so the next attempt continues the same Cognito session.
        if (data?.session) setOtpSession(data.session)
        throw new Error(data?.error ?? 'Could not verify code')
      }
      router.push(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify code')
      setLoading(false)
    }
  }

  const inputClass =
    'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'

  const tabClass = (t: typeof tab) =>
    `px-4 py-2 text-sm tracking-widest transition-colors ${
      tab === t
        ? 'border-b-2 border-primary text-primary -mb-px'
        : 'text-muted hover:text-fg'
    }`

  // Sign in / sign up via Strava goes through a server-driven OAuth round
  // trip; the button is a plain <a> rather than a form submit because the
  // /init endpoint sets a CSRF state cookie and 302s to Strava.
  const stravaHref = `/att/api/auth/strava/init?next=${encodeURIComponent(next)}`

  return (
    <div className="w-full max-w-sm">
      <div className="flex justify-center mb-2">
        <StravaButton href={stravaHref} />
      </div>
      <p className="text-xs text-muted mb-6 text-center leading-relaxed">
        Strava doesn&apos;t share your email, so after you continue we&apos;ll ask you to add one — that&apos;s
        how we reach you about your account and group invitations. Already have an email account here?
        Sign in below first and connect Strava from your account page, so it links to that account
        instead of creating a new one.
      </p>
      <div className="flex items-center gap-3 mb-6 text-xs text-muted tracking-widest">
        <span className="flex-1 h-px bg-border" />
        OR
        <span className="flex-1 h-px bg-border" />
      </div>

      <div className="flex border-b border-border mb-8">
        <button type="button" onClick={() => { setTab('signin'); setError('') }} className={tabClass('signin')}>
          SIGN IN
        </button>
        <button type="button" onClick={() => { setTab('signup'); setError('') }} className={tabClass('signup')}>
          SIGN UP
        </button>
        <button type="button" onClick={() => { setTab('code'); setError(''); setOtpSession(''); setOtpCode('') }} className={tabClass('code')}>
          EMAIL CODE
        </button>
      </div>

      {tab === 'signin' && (
        <form onSubmit={handleSignIn} className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">PASSWORD</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
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
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
          <p className="text-xs text-muted text-center">
            No account?{' '}
            <button
              type="button"
              onClick={() => { setTab('signup'); setError('') }}
              className="tt-link"
            >
              Sign up
            </button>
            {' · '}
            <Link href="/att/auth/forgot" className="tt-link">
              Forgot password?
            </Link>
          </p>
        </form>
      )}

      {tab === 'signup' && (
        <form onSubmit={handleSignUp} className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">DISPLAY NAME</label>
            <input
              type="text"
              required
              autoComplete="name"
              placeholder="e.g. John Smith"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">PASSWORD</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputClass}
            />
            <p className="text-xs text-muted">Minimum 8 characters</p>
          </div>
          {/* ToS acceptance — required for account creation. The checkbox
              has to be ticked AND the server side checks the version on
              POST, so a stale rendering won't accept a future version. */}
          <label className="flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={tosAccepted}
              onChange={e => setTosAccepted(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              I have read and agree to the{' '}
              <Link href="/att/tos" target="_blank" className="tt-link">
                Terms of Service
              </Link>
              {' '}and{' '}
              <Link href="/att/privacy" target="_blank" className="tt-link">
                Privacy Policy
              </Link>.
            </span>
          </label>
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
            {loading ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT'}
          </button>
          <p className="text-xs text-muted text-center">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => { setTab('signin'); setError('') }}
              className="tt-link"
            >
              Sign in
            </button>
          </p>
        </form>
      )}

      {tab === 'code' && (
        otpSession ? (
          <form onSubmit={handleOtpVerify} className="flex flex-col gap-4">
            <p className="text-xs text-muted">
              We&apos;ve emailed a 6-digit code to <strong>{email}</strong>. Paste it below.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted tracking-widest">CODE</label>
              <input
                type="text"
                required
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={otpCode}
                onChange={e => setOtpCode(e.target.value)}
                className={`${inputClass} tracking-widest`}
                placeholder="000000"
                autoFocus
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
              {loading ? 'VERIFYING…' : 'SIGN IN'}
            </button>
            <p className="text-xs text-muted text-center">
              Didn&apos;t arrive?{' '}
              <button
                type="button"
                onClick={() => { setOtpSession(''); setOtpCode(''); setError('') }}
                className="tt-link"
              >
                Try a different email
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleOtpRequest} className="flex flex-col gap-4">
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
            <p className="text-xs text-muted">
              Enter your email and we&apos;ll send you a one-time code. No password needed.
            </p>
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
          </form>
        )
      )}

    </div>
  )
}

export default function AuthPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-4 py-3">
        <Link href="/att">
          <span className="text-fg font-bold text-lg tracking-widest">ATT</span>
          <span className="text-muted text-xs tracking-widest ml-3 hidden sm:inline">AUTOMATED TIME TRIALS</span>
        </Link>
      </header>
      <div className="flex-1 flex items-start justify-center pt-16 px-4">
        <Suspense>
          <AuthForm />
        </Suspense>
      </div>
    </main>
  )
}
