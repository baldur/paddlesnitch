'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Badge, cardClass } from '@paddlesnitch/ui/Card'
import { buttonClass } from '@paddlesnitch/ui/Button'
import GoogleButton from '@/components/GoogleButton'

// Account's Google section: Connect Google (lib/google-link.ts), so an
// account made with an email can sign in with Google too. The result comes
// back as ?google=<key> from google/link or google/callback.
const RESULTS: Record<string, { tone: 'ok' | 'err'; text: string }> = {
  connected: { tone: 'ok', text: 'Google is connected. You can now sign in with Google.' },
  different_email: { tone: 'err', text: 'Couldn’t connect Google: that Google account uses a different email. Choose the Google account with the email you use here.' },
  link_failed: { tone: 'err', text: 'Couldn’t connect Google. Please try again.' },
  google_failed: { tone: 'err', text: 'Couldn’t connect Google. Please try again.' },
  google_denied: { tone: 'err', text: 'You cancelled connecting Google.' },
  google_no_email: { tone: 'err', text: 'Couldn’t connect Google, because Google didn’t share a confirmed email address.' },
  google_not_configured: { tone: 'err', text: 'Google isn’t available right now.' },
  use_website: { tone: 'err', text: 'Connect Google on the website after signing in there, not from a link the app opened.' },
}

type Status = { signsInWithGoogle: boolean; connected: boolean }

export default function GoogleConnect({ onSignInAgain, signingIn }: { onSignInAgain: () => void; signingIn: boolean }) {
  const key = useSearchParams().get('google')
  const result = key ? RESULTS[key] : undefined
  const [status, setStatus] = useState<Status | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/account/google')
      .then(r => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [key])

  return (
    <section id="google" className="flex flex-col gap-3 scroll-mt-4">
      <h2 className="text-lg font-semibold text-fg">Google</h2>
      {result && (
        <p role={result.tone === 'err' ? 'alert' : 'status'}
          className={`rounded-control border px-3 py-2 text-sm ${result.tone === 'ok' ? 'border-green/50 bg-green/10 text-green' : 'border-red/50 bg-red/10 text-red'}`}>
          {result.text}
        </p>
      )}
      {key === 'reauth' && (
        <div className="rounded-control border border-border bg-surface p-4 flex flex-col gap-3">
          <p role="status" className="text-sm text-fg">For your safety, connecting Google needs a recent sign-in. Sign in again and you’ll come straight back here.</p>
          <div>
            <button type="button" onClick={onSignInAgain} disabled={signingIn} className={buttonClass('secondary')}>
              {signingIn ? 'Sign in again…' : 'Sign in again'}
            </button>
          </div>
        </div>
      )}
      {status === undefined && <p className="text-base text-muted">Checking…</p>}
      {status === null && <p className="text-base text-muted">Couldn’t check Google. Please reload the page.</p>}
      {status?.signsInWithGoogle && <p className="text-base text-muted">You sign in with Google.</p>}
      {status && !status.signsInWithGoogle && status.connected && (
        <div className={`${cardClass} flex items-center gap-2 px-4 py-2`}>
          <Badge tone="green">Connected</Badge>
          <span className="text-base text-fg">You can sign in with Google or your email.</span>
        </div>
      )}
      {status && !status.connected && (
        <>
          <p className="text-base text-muted">Connect Google to sign in with it. Choose the Google account with the email you use here.</p>
          <div><GoogleButton href="/att/api/auth/google/link" post={{}} label="Continue with Google" /></div>
        </>
      )}
    </section>
  )
}
