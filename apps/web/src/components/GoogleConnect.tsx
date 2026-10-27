'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Badge, cardClass } from '@paddlesnitch/ui/Card'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import GoogleButton from '@/components/GoogleButton'

// Account's Google section: Connect Google (lib/google-link.ts), so an account
// made with an email can sign in with Google too. The result comes back as
// ?google=<key> from google/link or google/callback.
type Tone = 'ok' | 'err' | 'quiet'
const RESULTS: Record<string, (email: string) => { tone: Tone; text: string }> = {
  connected: () => ({ tone: 'ok', text: 'Google connected.' }),
  different_email: (email) => ({ tone: 'err', text: `Couldn’t connect Google: that Google account uses a different email. Choose the Google account for ${email || 'the email you use here'}.` }),
  linked_elsewhere: () => ({ tone: 'err', text: 'Couldn’t connect Google: that Google account already has its own paddlesnitch account.' }),
  link_failed: () => ({ tone: 'err', text: 'Couldn’t connect Google. Please try again.' }),
  google_failed: () => ({ tone: 'err', text: 'Couldn’t connect Google. Please try again.' }),
  google_denied: () => ({ tone: 'quiet', text: 'You cancelled connecting Google.' }),
  google_no_email: () => ({ tone: 'err', text: 'Couldn’t connect Google, because Google didn’t share a confirmed email address. Confirm your email with Google, then try again.' }),
  google_not_configured: () => ({ tone: 'err', text: 'Couldn’t connect Google right now. Please try again later.' }),
  use_website: () => ({ tone: 'err', text: 'Couldn’t connect Google here. Sign out, sign in on this website, then try again.' }),
  email_unproved: () => ({ tone: 'err', text: 'Couldn’t connect Google: confirm your email address first.' }),
  disconnected: () => ({ tone: 'ok', text: 'Google disconnected.' }),
  disconnect_failed: () => ({ tone: 'err', text: 'Couldn’t disconnect Google. Please try again.' }),
}
const TONE: Record<Tone, string> = {
  ok: 'border-green/50 bg-green/10 text-green',
  err: 'border-red/50 bg-red/10 text-red',
  quiet: 'border-border bg-surface text-muted',
}
const msgClass = 'text-sm text-muted'

type Status = { signsInWithGoogle: boolean; connected: boolean; email: string; canConnect: boolean; emailProven: boolean; canDisconnect: boolean }

export default function GoogleConnect({ onSignInAgain, signingIn, signInError }: { onSignInAgain: () => void; signingIn: boolean; signInError: string }) {
  const key = useSearchParams().get('google')
  const [status, setStatus] = useState<Status | null | undefined>(undefined)
  const load = () => fetch('/api/account/google')
    .then(r => (r.ok ? r.json() : null))
    .then(setStatus)
    .catch(() => setStatus(null))
  useEffect(() => { void load() }, [key])
  const result = key ? RESULTS[key]?.(status?.email ?? '') : undefined
  const reauth = key === 'reauth'

  return (
    <section id="google" className="flex flex-col gap-3 scroll-mt-4">
      <h2 className="text-lg font-semibold text-fg">Google</h2>
      {result && (
        <p role={result.tone === 'err' ? 'alert' : 'status'} className={`rounded-control border px-3 py-2 text-sm ${TONE[result.tone]}`}>
          {result.text}
        </p>
      )}
      {reauth && (
        <div className="rounded-control border border-border bg-surface p-4 flex flex-col gap-3">
          <p role="status" className="text-sm text-fg">For your safety, connecting Google needs a recent sign-in. Sign in again and you’ll come straight back here.</p>
          {signInError && <p role="alert" className="text-sm text-red">{signInError}</p>}
          <div>
            <button type="button" onClick={onSignInAgain} disabled={signingIn} className={buttonClass('secondary')}>
              {signingIn ? 'Sign in again…' : 'Sign in again'}
            </button>
          </div>
        </div>
      )}
      {status === undefined && <p className={msgClass}>Checking…</p>}
      {status === null && <p className={msgClass}>Couldn’t check Google. Please reload the page.</p>}
      {status?.connected && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-4 py-2`}>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Badge tone="green">Connected</Badge>
            <span className="text-base text-fg">{status.signsInWithGoogle ? 'You sign in with Google.' : 'You can sign in with Google or your email.'}</span>
          </div>
          {status.canDisconnect && (
            <form method="post" action="/att/api/auth/google/unlink">
              <button type="submit" className={buttonClass('quiet')}>Disconnect</button>
            </form>
          )}
        </div>
      )}
      {status && !status.connected && !reauth && (status.canConnect ? (
        status.emailProven ? (
          <>
            <p className="text-base text-muted">Connect Google to sign in with it. It must be the Google account for {status.email}.</p>
            <div><GoogleButton href="/att/api/auth/google/link" post={{}} label="Continue with Google" /></div>
          </>
        ) : (
          <ConfirmEmail email={status.email} onDone={load} />
        )
      ) : (
        <p className={msgClass}>To connect Google, your account needs an email address you’ve confirmed.</p>
      ))}
    </section>
  )
}

// Connect Google needs an email this account has proved (accounts made before
// sign-up codes, 2026-10-26, never did): a code to the address, entered here.
function ConfirmEmail({ email, onDone }: { email: string; onDone: () => void }) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'send' | 'confirm' | null>(null)
  const [error, setError] = useState('')
  const ask = async (body: object, step: 'send' | 'confirm') => {
    setBusy(step); setError('')
    try {
      const res = await fetch('/api/account/email-proof', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) { setError(out.error ?? 'Couldn’t do that. Please try again.'); return false }
      return true
    } catch {
      setError('Couldn’t reach paddlesnitch. Please try again.')
      return false
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">
        To connect Google, first confirm that {email} is yours. We’ll email it a 6-digit code.
      </p>
      {error && <p role="alert" className="text-sm text-red">{error}</p>}
      {!sent ? (
        <div>
          <button type="button" disabled={busy !== null} className={buttonClass('secondary')}
            onClick={async () => { if (await ask({}, 'send')) setSent(true) }}>
            {busy === 'send' ? 'Sending…' : 'Send code'}
          </button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={async e => { e.preventDefault(); if (await ask({ code }, 'confirm')) onDone() }}>
          <Field label="Code" htmlFor="google-email-code">
            <input id="google-email-code" className={`${inputClass} tabular max-w-40`} inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy !== null || code.length !== 6} className={buttonClass('primary')}>
              {busy === 'confirm' ? 'Confirming…' : 'Confirm email'}
            </button>
            <button type="button" disabled={busy !== null} className={buttonClass('quiet')} onClick={() => void ask({}, 'send')}>
              {busy === 'send' ? 'Sending…' : 'Send a new code'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
