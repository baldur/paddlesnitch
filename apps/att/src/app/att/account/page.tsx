'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import StravaButton from '@/components/strava/StravaButton'
import PoweredByStrava from '@/components/strava/PoweredByStrava'
import LoadingState from '@/components/LoadingState'
import { isSyntheticStravaEmail } from '@/lib/strava-account'
import type { AuthUser } from '@/lib/types'

type StravaStatus =
  | { connected: false }
  | { connected: true; athlete: { id: number; name: string } }

// Banner copy keyed off the ?strava= query param the callback sets when it
// finishes. Keeps redirects round-trippable instead of relying on session state.
const STRAVA_FLASH: Record<string, { tone: 'ok' | 'err'; text: string }> = {
  connected: { tone: 'ok', text: 'Strava connected.' },
  denied: { tone: 'err', text: 'Strava connection cancelled.' },
  state_mismatch: { tone: 'err', text: 'Strava connect failed (state mismatch). Please try again.' },
  exchange_failed: { tone: 'err', text: 'Strava connect failed during token exchange. Please try again.' },
  not_configured: { tone: 'err', text: 'Strava is not configured on this server.' },
}

export default function AccountPage() {
  // Suspense wrapper required because the inner component reads
  // useSearchParams (which marks the route as needing CSR bailout in
  // Next.js 16). The fallback never shows in practice — the page renders
  // its own "Loading…" state once the auth /me promise resolves.
  return (
    <Suspense fallback={null}>
      <AccountPageInner />
    </Suspense>
  )
}

function AccountPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const stravaFlashKey = searchParams.get('strava')
  const stravaFlash = stravaFlashKey ? STRAVA_FLASH[stravaFlashKey] : undefined

  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState<'export' | 'delete' | 'strava' | 'contact' | null>(null)
  const [error, setError] = useState('')
  const [strava, setStrava] = useState<StravaStatus | undefined>(undefined)
  const [contactEmail, setContactEmail] = useState<string>('')
  const [contactSaved, setContactSaved] = useState<string | null>(null)
  const [contactMsg, setContactMsg] = useState('')
  const [profilePublic, setProfilePublic] = useState<boolean | undefined>(undefined)
  const [profileSaving, setProfileSaving] = useState(false)
  const [handle, setHandle] = useState<string | null>(null)
  const [handleInput, setHandleInput] = useState('')
  const [handleMsg, setHandleMsg] = useState('')
  const [handleSaving, setHandleSaving] = useState(false)

  useEffect(() => {
    fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    fetch('/att/api/strava/status')
      .then(r => (r.ok ? r.json() : { connected: false }))
      .then(setStrava)
      .catch(() => setStrava({ connected: false }))
  }, [stravaFlashKey])

  useEffect(() => {
    // Only fetch when we know we have a user — saves an unnecessary
    // round-trip on signed-out renders.
    if (!user) return
    fetch('/att/api/account/contact')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const saved = d?.contact?.email ?? null
        setContactSaved(saved)
        setContactEmail(saved ?? '')
      })
      .catch(() => { /* leave defaults */ })
  }, [user])

  useEffect(() => {
    if (!user) return
    fetch('/att/api/account/profile')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setProfilePublic(!!d.public); setHandle(d.handle ?? null); setHandleInput(d.handle ?? '') } })
      .catch(() => { /* leave undefined */ })
  }, [user])

  async function saveHandle() {
    setHandleMsg('')
    setHandleSaving(true)
    try {
      const res = await fetch('/att/api/account/handle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handleInput.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not save handle')
      setHandle(body.handle ?? null)
      setHandleInput(body.handle ?? '')
      setHandleMsg('Saved.')
    } catch (err) {
      setHandleMsg(err instanceof Error ? err.message : 'Could not save handle')
    } finally {
      setHandleSaving(false)
    }
  }

  async function releaseHandle() {
    setHandleMsg('')
    setHandleSaving(true)
    try {
      const res = await fetch('/att/api/account/handle', { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not release handle')
      setHandle(null)
      setHandleInput('')
      setHandleMsg('Handle released.')
    } catch (err) {
      setHandleMsg(err instanceof Error ? err.message : 'Could not release handle')
    } finally {
      setHandleSaving(false)
    }
  }

  async function toggleProfilePublic(next: boolean) {
    setProfileSaving(true)
    setError('')
    try {
      const res = await fetch('/att/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not update profile')
      setProfilePublic(!!body.public)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile')
    } finally {
      setProfileSaving(false)
    }
  }

  async function saveContactEmail(e: React.FormEvent) {
    e.preventDefault()
    setContactMsg('')
    setWorking('contact')
    try {
      const res = await fetch('/att/api/account/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contactEmail.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not save email')
      setContactSaved(body.contact.email)
      setContactMsg('Saved.')
    } catch (err) {
      setContactMsg(err instanceof Error ? err.message : 'Could not save email')
    } finally {
      setWorking(null)
    }
  }

  async function clearContactEmail() {
    setContactMsg('')
    setWorking('contact')
    try {
      const res = await fetch('/att/api/account/contact', { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not clear email')
      setContactSaved(null)
      setContactEmail('')
      setContactMsg('Removed.')
    } catch (err) {
      setContactMsg(err instanceof Error ? err.message : 'Could not clear email')
    } finally {
      setWorking(null)
    }
  }

  async function disconnectStrava() {
    setError('')
    setWorking('strava')
    try {
      const res = await fetch('/att/api/strava/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Disconnect failed')
      setStrava({ connected: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setWorking(null)
    }
  }

  async function downloadExport() {
    setError('')
    setWorking('export')
    try {
      const res = await fetch('/att/api/account/export')
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Server already sets Content-Disposition; the anchor download attribute
      // is the cross-browser fallback. Filename comes from the server header.
      a.download = ''
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setWorking(null)
    }
  }

  async function deleteAccount() {
    setError('')
    setWorking('delete')
    try {
      const res = await fetch('/att/api/account', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Deletion failed')
      }
      // Account gone. Send them home.
      router.replace('/att')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed')
      setWorking(null)
    }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">
              ← HOME
            </Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">ACCOUNT</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-10">
        {user === undefined && <LoadingState className="py-16" />}

        {user === null && (
          <div className="flex flex-col gap-4 text-center pt-16">
            <h1 className="text-lg font-bold text-fg tracking-widest">SIGN IN REQUIRED</h1>
            <p className="text-sm text-muted">
              Sign in to view or manage your account data.
            </p>
            <Link
              href="/att/auth?next=/att/account"
              className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary transition-colors self-center"
            >
              SIGN IN
            </Link>
          </div>
        )}

        {user && (
          <>
            <section>
              <h1 className="text-lg font-bold text-fg tracking-widest mb-6">YOUR ACCOUNT</h1>
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <dt className="text-muted tracking-widest text-xs uppercase">Email</dt>
                <dd className="col-span-2 text-fg tabular">{user.email}</dd>
                <dt className="text-muted tracking-widest text-xs uppercase">Display name</dt>
                <dd className="col-span-2 text-fg">{user.displayName}</dd>
                <dt className="text-muted tracking-widest text-xs uppercase">User ID</dt>
                <dd className="col-span-2 text-muted tabular text-xs break-all">{user.id}</dd>
              </dl>
            </section>

            {/* Contact email — only shown to Strava-only accounts (those
                with a synthesised email). Email-and-password users already
                have a real email and don't need this. */}
            {isSyntheticStravaEmail(user.email) && (
              <section>
                <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">
                  Contact email
                </h2>
                <p className="text-sm text-muted mb-4 leading-relaxed">
                  You signed in with Strava, so the address on your account
                  ({user.email}) is a placeholder we can&apos;t deliver to.
                  <span className="text-fg"> Until you add a real email, we have no way to
                  reach you</span> — including if our Terms of Service change, or if there&apos;s a
                  problem with your account or a group invitation. Add one below (we&apos;ll never
                  share it). It&apos;s optional, but recommended.
                </p>
                <form onSubmit={saveContactEmail} className="flex flex-col sm:flex-row gap-2 mb-3">
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors flex-1"
                  />
                  <button
                    type="submit"
                    disabled={working === 'contact' || !contactEmail.trim()}
                    className="px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {working === 'contact' ? 'SAVING…' : (contactSaved ? 'UPDATE' : 'SAVE')}
                  </button>
                  {contactSaved && (
                    <button
                      type="button"
                      onClick={clearContactEmail}
                      disabled={working === 'contact'}
                      className="px-4 py-2 border border-border text-muted text-xs tracking-widest hover:bg-surface-2 disabled:opacity-50 transition-colors"
                    >
                      REMOVE
                    </button>
                  )}
                </form>
                {contactMsg && (
                  <p className="text-xs text-muted">{contactMsg}</p>
                )}
              </section>
            )}

            <section>
              <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">
                Strava integration
              </h2>
              <p className="text-sm text-muted mb-4 leading-relaxed">
                Connect Strava once to do two things: import any of your recent water-sport
                activities straight into a time trial (no GPX export needed), and sign in with
                Strava next time instead of your email and password. We only request read access
                and never post anything to your Strava account.
              </p>

              {stravaFlash && (
                <div
                  className={`mb-4 border px-3 py-2 text-xs ${
                    stravaFlash.tone === 'ok'
                      ? 'border-green bg-green/10 text-green'
                      : 'border-red bg-red/10 text-red'
                  }`}
                >
                  {stravaFlash.text}
                </div>
              )}

              {strava === undefined && (
                <p className="text-xs text-muted">Checking…</p>
              )}

              {strava && !strava.connected && (
                <StravaButton href="/att/api/strava/connect" />
              )}

              {strava && strava.connected && (
                <>
                  <div className="flex items-center justify-between gap-4 border border-border px-4 py-3">
                    <div className="text-sm">
                      <span className="text-green tracking-widest text-xs mr-2">CONNECTED</span>
                      <span className="text-fg">{strava.athlete.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={disconnectStrava}
                      disabled={working === 'strava'}
                      className="px-4 py-2 border border-muted text-muted text-xs tracking-widest hover:bg-surface-2 disabled:opacity-50 transition-colors"
                    >
                      {working === 'strava' ? 'DISCONNECTING…' : 'DISCONNECT'}
                    </button>
                  </div>
                  {/* Attribution: this row shows the athlete's Strava profile name. */}
                  <PoweredByStrava className="mt-2" />
                  <p className="text-xs text-muted mt-2">
                    You can now use <span className="text-[#fc4c02]">Continue with Strava</span> on the
                    sign-in page to log in to this account. Disconnecting stops both activity import and
                    Strava sign-in.
                  </p>
                </>
              )}
            </section>

            <section>
              <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">
                Public profile
              </h2>
              <p className="text-sm text-muted mb-4 leading-relaxed">
                A public profile page shows your race history, personal bests and stats at a shareable link.
                It only ever shows results from trials people can already see — private and group-only results stay hidden.
                Off by default.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => toggleProfilePublic(!profilePublic)}
                  disabled={profilePublic === undefined || profileSaving}
                  className="px-6 py-2.5 border border-primary text-primary font-bold text-sm tracking-widest hover:bg-primary/10 disabled:opacity-50 transition-colors"
                >
                  {profileSaving
                    ? 'SAVING…'
                    : profilePublic
                      ? 'MAKE PROFILE PRIVATE'
                      : 'MAKE PROFILE PUBLIC'}
                </button>
                {user && (
                  <Link href={`/att/u/${handle ?? user.id}`} className="tt-link text-sm">
                    {profilePublic ? 'View my profile →' : 'Preview my profile →'}
                  </Link>
                )}
              </div>

              {/* Vanity handle */}
              <div className="mt-5 flex flex-col gap-2">
                <label className="text-xs text-muted tracking-widest">PROFILE HANDLE</label>
                <p className="text-xs text-muted">
                  Claim a handle for a memorable link like{' '}
                  <span className="text-fg">/att/u/{handle || 'your-handle'}</span>.
                  Lowercase letters, numbers and hyphens, 3–30 characters.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted">/att/u/</span>
                  <input
                    type="text"
                    value={handleInput}
                    onChange={e => setHandleInput(e.target.value)}
                    placeholder="your-handle"
                    className="bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={saveHandle}
                    disabled={handleSaving || !handleInput.trim() || handleInput.trim() === handle}
                    className="px-4 py-2 border border-primary text-primary text-xs tracking-widest hover:bg-primary/10 disabled:opacity-50 transition-colors"
                  >
                    {handleSaving ? 'SAVING…' : handle ? 'CHANGE' : 'CLAIM'}
                  </button>
                  {handle && (
                    <button
                      type="button"
                      onClick={releaseHandle}
                      disabled={handleSaving}
                      className="px-4 py-2 border border-border text-muted text-xs tracking-widest hover:border-red hover:text-red disabled:opacity-50 transition-colors"
                    >
                      RELEASE
                    </button>
                  )}
                </div>
                {handleMsg && <p className="text-xs text-muted">{handleMsg}</p>}
              </div>
            </section>

            <section>
              <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">
                Download my data
              </h2>
              <p className="text-sm text-muted mb-4 leading-relaxed">
                Get a JSON file containing every piece of personal data paddlesnitch.com holds about you:
                your profile, every course and trial you created, every entry you submitted. Backs your
                right of access (UK GDPR Art. 15) and data portability (Art. 20).
              </p>
              <button
                type="button"
                onClick={downloadExport}
                disabled={working === 'export'}
                className="px-6 py-2.5 border border-primary text-primary font-bold text-sm tracking-widest hover:bg-primary/10 disabled:opacity-50 transition-colors"
              >
                {working === 'export' ? 'PREPARING…' : 'DOWNLOAD MY DATA (.json)'}
              </button>
            </section>

            <section className="border-t border-border pt-8">
              <h2 className="text-xs text-red tracking-[0.2em] uppercase mb-3">
                Delete my account
              </h2>
              <p className="text-sm text-muted mb-4 leading-relaxed">
                Permanently removes your account from Cognito, every course and trial you created,
                every entry you submitted across all trials (their leaderboards rebuild without you),
                and clears your sign-in cookies. <strong className="text-red">This is immediate and cannot be undone.</strong> Backs
                your right to erasure (UK GDPR Art. 17).
              </p>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-6 py-2.5 border border-red text-red font-bold text-sm tracking-widest hover:bg-red/10 transition-colors"
                >
                  DELETE MY ACCOUNT
                </button>
              ) : (
                <div className="border border-red bg-red/10 p-4 flex flex-col gap-3">
                  <p className="text-sm text-fg">
                    Type <strong>DELETE</strong> to confirm. There is no undo.
                  </p>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    className="bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-red"
                    autoFocus
                  />
                  <div className="flex gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={deleteAccount}
                      disabled={confirmText !== 'DELETE' || working === 'delete'}
                      className="px-6 py-2.5 bg-red text-white font-bold text-sm tracking-widest hover:bg-red disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {working === 'delete' ? 'DELETING…' : 'CONFIRM DELETION'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setConfirmDelete(false); setConfirmText('') }}
                      disabled={working === 'delete'}
                      className="px-6 py-2.5 border border-muted text-muted text-sm tracking-widest hover:bg-surface-2 disabled:opacity-50 transition-colors"
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
            </section>

            {error && (
              <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
                {error}
              </div>
            )}

            <section className="text-xs text-muted border-t border-border pt-6">
              See the{' '}
              <Link href="/att/privacy" className="tt-link">privacy policy</Link>{' '}
              for full details on what we hold, why, and how to exercise rights we can&apos;t handle from
              this page. For rectification or other requests, email{' '}
              <a href="mailto:privacy@paddlesnitch.com" className="tt-link">
                privacy@paddlesnitch.com
              </a>
              .
            </section>
          </>
        )}
      </div>
    </main>
  )
}
