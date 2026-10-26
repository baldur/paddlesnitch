'use client'
import Link from 'next/link'
import { EMAIL_DELIVERY } from '@/lib/email-delivery'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeNext } from '@paddlesnitch/core/url'
import StravaButton from '@/components/strava/StravaButton'
import GoogleButton from '@/components/GoogleButton'
import { googleSignInOn, stravaOn } from '@/lib/sign-in-options'

// Google and Strava are switched on per build (lib/sign-in-options.ts).
const GOOGLE_SIGNIN = googleSignInOn()
const STRAVA = stravaOn()
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { termsAcceptPath } from '@/lib/terms-path'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { Field, Segmented, inputClass } from '@paddlesnitch/ui/Form'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { useMountedAt } from '@/lib/use-mounted-at'

// Signed in: load the next page in full, so its header shows the new user (the
// root layout, where the header gets it, isn't re-rendered by router.push).
const signedIn = (path: string) => window.location.assign(path)

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get('next'))

  // Redirect if already signed in ( /me now answers 200 with a null body when
  // signed out, so key off the body, not r.ok )
  useEffect(() => {
    fetch('/att/api/auth/me')
      .then(r => r.json())
      .then(user => { if (user) router.replace(next) })
      .catch(() => {})
  }, [next, router])

  const [tab, setTab] = useState<'signin' | 'signup' | 'code'>('signin')
  const [email, setEmail] = useState('')
  // Why they're here, shown as a notice (not an error): kept apart from `error`,
  // so switching tabs or a wrong password doesn't clear it.
  const notice = searchParams.get('reason') === 'reauth_delete'
    ? 'For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back to Delete account.'
    : searchParams.get('reason') === 'reauth_strava'
      ? 'For your safety, connecting Strava needs a recent sign-in. Sign in again and you’ll come straight back to Account.'
      : ''
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  // ToS acceptance is mandatory on signup; the checkbox lives just above
  // the submit button. The version sent on POST is CURRENT_TOS_VERSION, so a
  // bump can't leave the form sending a stale one.
  const [tosAccepted, setTosAccepted] = useState(false)
  // ?error= comes back from server-driven flows (Strava OAuth callback,
  // legacy magic-link). Map known keys to user-friendly messages once.
  const initialError = (() => {
    const e = searchParams.get('error')
    if (e === 'magic_disabled') return STRAVA ? 'That sign-in link no longer works. Use your password, or sign in with Strava.' : 'That sign-in link no longer works. Use your password instead.'
    if (e === 'strava_denied') return 'You cancelled the Strava sign-in.'
    if (e === 'strava_state_mismatch') return 'Strava sign-in didn’t finish. Please try again.'
    if (e === 'strava_exchange_failed') return 'Strava sign-in didn’t finish. Please try again.'
    if (e === 'strava_profile_failed') return 'Couldn’t load your Strava profile. Please try again.'
    // strava_no_email was retired — Strava never shares email with
    // third-party apps, so we now synthesise a placeholder address at
    // sign-in. See src/app/att/api/auth/strava/callback/route.ts.
    if (e === 'strava_user_create_failed') return 'Couldn’t create an account from your Strava profile. Please sign up with your email instead.'
    if (e === 'strava_signin_failed') return 'Strava sign-in didn’t finish. Please try again.'
    if (e === 'google_denied') return 'You cancelled the Google sign-in.'
    if (e === 'google_failed') return 'Couldn’t sign in with Google. Please try again.'
    if (e === 'google_account_exists') return STRAVA ? 'You already have an account with this email. Sign in with your email or Strava instead.' : 'You already have an account with this email. Sign in with your email instead.'
    if (e === 'google_no_email') return 'Couldn’t sign in with Google, because Google didn’t share a confirmed email address. Please sign up with your email instead.'
    if (e === 'google_not_configured') return 'Google sign-in isn’t available right now.'
    if (e === 'app_link_expired') return 'That link from the app has expired. Sign in here, or open it from the app again.'
    if (e === 'strava_use_google') return 'Your account signs in with Google. Please sign in with Google instead.'
    if (e === 'strava_not_configured') return 'Strava sign-in isn’t available right now.'
    return ''
  })()
  const [error, setError] = useState(initialError)
  const [loading, setLoading] = useState(false)
  // OTP flow state. `session` is non-empty once the user has requested a code
  // and we're waiting for them to type it in.
  // Sign-up code (#702): set once a code has gone to `email`, from Create
  // account or from signing in to an account whose code was never entered.
  // "Send a new code" repeats that same request.
  const [confirming, setConfirming] = useState<'signup' | 'signin' | null>(null)
  const [signupCode, setSignupCode] = useState('')
  // A new code: sending, what happened (a status, not an error), and a pause
  // before the next one (every code is an email from a small daily allowance).
  const [resending, setResending] = useState(false)
  const [codeStatus, setCodeStatus] = useState('')
  const [coolingDown, setCoolingDown] = useState(false)
  const [otpSession, setOtpSession] = useState('')
  const [otpCode, setOtpCode] = useState('')
  // Anti-bot fields for the passwordless code request (which sends an email):
  // a honeypot the user never sees, and the elapsed time since the page loaded.
  const [website, setWebsite] = useState('')
  const mountedAt = useMountedAt()

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
        const data = await res.json().catch(() => ({}))
        signedIn(data?.needsTerms ? termsAcceptPath(next) : next)
      } else {
        const data = await res.json()
        if (data?.needsCode) {
          setConfirming('signin')
          setSignupCode('')
          setCodeStatus(data.error)
          startCooldown()
        } else setError(data.error ?? 'Couldn’t sign you in. Please try again.')
        setLoading(false)
      }
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.')
      setLoading(false)
    }
  }

  const startCooldown = () => {
    setCoolingDown(true)
    setTimeout(() => setCoolingDown(false), 30_000)
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
        body: JSON.stringify({ email, displayName, password, acceptedTosVersion: CURRENT_TOS_VERSION }),
      })
      if (res.ok) {
        setConfirming('signup')
        setSignupCode('')
        setCodeStatus('')
        startCooldown()
        setLoading(false)
      } else {
        const data = await res.json()
        setError(data.error ?? 'Couldn’t sign you up. Please try again.')
        setLoading(false)
      }
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.')
      setLoading(false)
    }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/signup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The Terms were ticked on Create account. Coming from Sign in they
        // weren't (on this visit): the Terms page asks if they're out of date.
        body: JSON.stringify({ email, code: signupCode, password, ...(confirming === 'signup' ? { acceptedTosVersion: CURRENT_TOS_VERSION } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        signedIn(data?.needsTerms ? termsAcceptPath(next) : next)
        return
      }
      setCodeStatus('')
      setError(data?.error ?? 'Couldn’t confirm your email. Please try again.')
      // Confirmed, but signing in failed: the Sign in form takes it from here.
      if (res.status === 500) { setConfirming(null); setTab('signin'); focusLater('signin-password') }
      setLoading(false)
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.')
      setLoading(false)
    }
  }

  const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

  // Repeats the request that sent the first code: Create account starts again
  // (which replaces the unconfirmed account), Sign in asks again.
  const sendNewCode = async () => {
    setError('')
    setCodeStatus('')
    setResending(true)
    try {
      const res = confirming === 'signup'
        ? await fetch('/att/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, displayName, password, acceptedTosVersion: CURRENT_TOS_VERSION }),
        })
        : await fetch('/att/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      const data = await res.json().catch(() => ({}))
      if (res.ok && confirming === 'signin') {
        // Someone entered the code meanwhile (another tab): signed in.
        signedIn(data?.needsTerms ? termsAcceptPath(next) : next)
        return
      }
      if (res.ok || data?.needsCode) {
        setSignupCode('')
        setCodeStatus('We’ve sent a new code. You can ask for another in 30 seconds.')
        startCooldown()
        focusLater('signup-code')
      } else {
        setError(data?.error ?? 'Couldn’t send a new code. Please try again.')
      }
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.')
    } finally {
      setResending(false)
    }
  }

  const changeEmail = () => {
    setConfirming(null)
    setError('')
    setCodeStatus('')
    focusLater(tab === 'signup' ? 'signup-email' : 'signin-email')
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
      if (!res.ok) throw new Error(data?.error ?? 'Couldn’t send the code. Please try again.')
      setOtpSession(data.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send the code. Please try again.')
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
        throw new Error(data?.error ?? 'That code didn’t work. Check it and try again.')
      }
      signedIn(data?.needsTerms ? termsAcceptPath(next) : next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work. Check it and try again.')
      setLoading(false)
    }
  }

  // Sign in / sign up via Strava goes through a server-driven OAuth round
  // trip; the button is a plain <a> rather than a form submit because the
  // /init endpoint sets a CSRF state cookie and 302s to Strava.
  const stravaHref = `/att/api/auth/strava/init?next=${encodeURIComponent(next)}`
  const googleHref = `/att/api/auth/google/init?next=${encodeURIComponent(next)}`

  const switchTab = (t: typeof tab) => {
    setTab(t)
    setError('')
    setConfirming(null)
    if (t === 'code') { setOtpSession(''); setOtpCode('') }
  }

  const errorBox = error && (
    <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
  )

  return (
    <Page width="narrow" className="max-w-md">
      <PageHeader title={confirming ? 'Confirm your email' : tab === 'signup' ? 'Create account' : 'Sign in'} />

      <div className="flex flex-col gap-6">
        {notice && (
          <p role="status" className="rounded-control border border-border bg-surface p-3 text-sm text-fg">{notice}</p>
        )}
        {!confirming && <Segmented
          label="Sign in or create an account"
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'signin', label: 'Sign in' },
            { value: 'signup', label: 'Create account' },
            ...(EMAIL_DELIVERY ? [{ value: 'code' as const, label: 'Email code' }] : []),
          ]}
        />}

        {confirming && (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <p className="text-base text-muted">
              We&apos;ve emailed a 6-digit code to <strong className="text-fg [overflow-wrap:anywhere]">{email}</strong> to check the address is yours. It can take a minute; look in spam if it doesn&apos;t arrive.
            </p>
            {codeStatus && (
              <p role="status" className="rounded-control border border-border bg-surface p-3 text-sm text-fg">{codeStatus}</p>
            )}
            <Field label="Code" htmlFor="signup-code">
              <input
                id="signup-code"
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                value={signupCode}
                onChange={e => { setSignupCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeStatus('') }}
                className={`${inputClass} tabular`}
                placeholder="000000"
                autoFocus
              />
            </Field>
            {errorBox}
            <button type="submit" disabled={loading || resending} className={buttonClass('primary', 'md', 'w-full')}>
              {loading ? 'Confirming…' : 'Confirm email'}
            </button>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={sendNewCode} disabled={loading || resending || coolingDown} className={buttonClass('quiet', 'md', 'w-full')}>
                {resending ? 'Sending…' : 'Send a new code'}
              </button>
              <button type="button" onClick={changeEmail} disabled={loading || resending} className={buttonClass('quiet', 'md', 'w-full')}>
                Change email
              </button>
            </div>
          </form>
        )}

        {!confirming && tab === 'signin' && (
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <Field label="Email" htmlFor="signin-email">
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Password" htmlFor="signin-password">
              <input
                id="signin-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            {errorBox}
            <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full')}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="text-sm text-center">
              <Link href="/signin/forgot" className="tt-link">Forgot password?</Link>
            </p>
          </form>
        )}

        {!confirming && tab === 'signup' && (
          <form onSubmit={handleSignUp} className="flex flex-col gap-4">
            <Field label="Email" htmlFor="signup-email">
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Display name" htmlFor="signup-name" help="Shown on leaderboards. You can change it later.">
              <input
                id="signup-name"
                type="text"
                required
                autoComplete="name"
                placeholder="e.g. John Smith"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Password" htmlFor="signup-password" help="At least 8 characters.">
              <input
                id="signup-password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            {/* ToS acceptance — required for account creation. The checkbox
                has to be ticked AND the server side checks the version on
                POST, so a stale rendering won't accept a future version. */}
            <label className="flex items-start gap-3 text-sm text-muted min-h-11 py-1">
              <input
                type="checkbox"
                checked={tosAccepted}
                onChange={e => setTosAccepted(e.target.checked)}
                className="mt-0.5 w-5 h-5 shrink-0 accent-primary"
              />
              <span>
                I have read and agree to the{' '}
                <Link href="/terms" target="_blank" className="tt-link">
                  Terms of Service
                </Link>
                {' '}and{' '}
                <Link href="/privacy" target="_blank" className="tt-link">
                  Privacy Policy
                </Link>.
              </span>
            </label>
            {errorBox}
            <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full')}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        {!confirming && EMAIL_DELIVERY && tab === 'code' && (
          otpSession ? (
            <form onSubmit={handleOtpVerify} className="flex flex-col gap-4">
              <p className="text-base text-muted">
                We&apos;ve emailed a 6-digit code to <strong className="text-fg">{email}</strong>. Paste it below.
              </p>
              <Field label="Code" htmlFor="otp-code">
                <input
                  id="otp-code"
                  type="text"
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  className={`${inputClass} tabular`}
                  placeholder="000000"
                  autoFocus
                />
              </Field>
              {errorBox}
              <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full')}>
                {loading ? 'Checking…' : 'Sign in'}
              </button>
              <p className="text-sm text-muted text-center">
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
              <p className="text-base text-muted">
                We&apos;ll email you a one-time code. No password needed.
              </p>
              <Field label="Email" htmlFor="otp-email">
                <input
                  id="otp-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                />
              </Field>
              {errorBox}
              <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full')}>
                {loading ? 'Sending…' : 'Send code'}
              </button>
            </form>
          )
        )}
      </div>

      {/* Google and Strava are the secondary ways in, below the email form. */}
      {(GOOGLE_SIGNIN || STRAVA) && (
        <div className="flex flex-col items-center gap-3 border-t border-border pt-6">
          <p className="text-sm text-muted">{otherWays(GOOGLE_SIGNIN, STRAVA)}</p>
          {GOOGLE_SIGNIN && <GoogleButton href={googleHref} />}
          {STRAVA && <StravaButton href={stravaHref} />}
          {STRAVA && (
            <p className="text-sm text-muted text-center">
              Already have an account? Sign in first, then connect Strava in Account.
            </p>
          )}
        </div>
      )}
      {/* Accounts made through Strava have no email or password to use instead. */}
      {!STRAVA && (
        <div className="flex flex-col items-center gap-3 border-t border-border pt-6 mt-6">
          {/* Email, not Report an issue: reports are public, and people would write their name and email in them. */}
          <p className="text-sm text-muted text-center">Signed up with Strava? Strava sign-in is off for now. Email us and we’ll help you sign in.</p>
          <a href="mailto:privacy@paddlesnitch.com?subject=Signing%20in%20without%20Strava" className={buttonClass('secondary')}>Email us</a>
        </div>
      )}
    </Page>
  )
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  )
}

function otherWays(google: boolean, strava: boolean): string {
  if (google && strava) return 'Or use your Google or Strava account'
  return google ? 'Or use your Google account' : 'Or use your Strava account'
}
