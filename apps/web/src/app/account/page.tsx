'use client'
import Link from 'next/link'
import { STRAVA_CONNECT_RESULTS } from '@/lib/strava-connect-results'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import StravaButton from '@/components/strava/StravaButton'
import PoweredByStrava from '@/components/strava/PoweredByStrava'
import { StravaFirstImport, StravaMoreImport } from '@/components/strava/StravaHistoryImport'
import LoadingState from '@/components/LoadingState'
import { isSyntheticStravaEmail } from '@/lib/strava-account'
import type { AuthUser } from '@/lib/types'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { Badge, Chevron, EmptyState, cardClass, cardLinkClass } from '@paddlesnitch/ui/Card'
import { googleSignInOn, stravaOn } from '@/lib/sign-in-options'
import GoogleConnect from '@/components/GoogleConnect'

// Strava is switched off in some builds (lib/sign-in-options.ts).
const STRAVA = stravaOn()
const GOOGLE_SIGNIN = googleSignInOn()

// The page's sections, in order, for the in-page jump list (sm and up).
const SECTIONS: [string, string][] = [
  ['details', 'Your details'],
  ['profile', 'Public profile'],
  ['google', 'Google'],
  ['strava', 'Strava'],
  ['devices', 'Devices'],
  ['data', 'Your data'],
  ['delete', 'Delete account'],
]

type StravaStatus =
  | { connected: false }
  | { connected: true; athlete: { id: number; name: string }; autoImport: boolean }

// Banner copy keyed off the ?strava= query param the callback sets when it
// finishes. Keeps redirects round-trippable instead of relying on session state.
const STRAVA_FLASH: Record<string, { tone: 'ok' | 'err'; text: string }> = STRAVA_CONNECT_RESULTS

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
  const searchParams = useSearchParams()
  const stravaFlashKey = searchParams.get('strava')
  const stravaFlash = stravaFlashKey ? STRAVA_FLASH[stravaFlashKey] : undefined

  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  // Delete account: closed → (check) → 'signin' (needs a fresh sign-in) or 'confirm' (type DELETE).
  const [deleteStep, setDeleteStep] = useState<'closed' | 'checking' | 'signin' | 'confirm'>('closed')
  // Shown inside the Delete account / Strava sections, where the person is looking.
  const [deleteError, setDeleteError] = useState('')
  const [stravaSignInError, setStravaSignInError] = useState('')
  const [googleSignInError, setGoogleSignInError] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState<'export' | 'delete' | 'strava' | 'google' | 'contact' | null>(null)
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

  // Back from signing in again (?resume=delete): go to Delete account and open it.
  const resumeDelete = searchParams.get('resume') === 'delete'
  useEffect(() => {
    if (!user || !resumeDelete) return
    // Used once: a reload after Cancel shouldn't reopen it.
    window.history.replaceState(null, '', '/account#delete')
    document.getElementById('delete')?.scrollIntoView()
    void openDelete()
  }, [user, resumeDelete])

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
    fetch('/api/account/contact')
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
    fetch('/api/account/profile')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setProfilePublic(!!d.public); setHandle(d.handle ?? null); setHandleInput(d.handle ?? '') } })
      .catch(() => { /* leave undefined */ })
  }, [user])

  async function saveHandle() {
    setHandleMsg('')
    setHandleSaving(true)
    try {
      const res = await fetch('/api/account/handle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handleInput.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Couldn’t save your handle. Please try again.')
      setHandle(body.handle ?? null)
      setHandleInput(body.handle ?? '')
      setHandleMsg('Saved.')
    } catch (err) {
      setHandleMsg(err instanceof Error ? err.message : 'Couldn’t save your handle. Please try again.')
    } finally {
      setHandleSaving(false)
    }
  }

  async function releaseHandle() {
    setHandleMsg('')
    setHandleSaving(true)
    try {
      const res = await fetch('/api/account/handle', { method: 'DELETE' })
      if (!res.ok) throw new Error('Couldn’t remove your handle. Please try again.')
      setHandle(null)
      setHandleInput('')
      setHandleMsg('Handle released.')
    } catch (err) {
      setHandleMsg(err instanceof Error ? err.message : 'Couldn’t remove your handle. Please try again.')
    } finally {
      setHandleSaving(false)
    }
  }

  async function toggleProfilePublic(next: boolean) {
    setProfileSaving(true)
    setError('')
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Couldn’t update your profile. Please try again.')
      setProfilePublic(!!body.public)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t update your profile. Please try again.')
    } finally {
      setProfileSaving(false)
    }
  }

  async function saveContactEmail(e: React.FormEvent) {
    e.preventDefault()
    setContactMsg('')
    setWorking('contact')
    try {
      const res = await fetch('/api/account/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contactEmail.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Couldn’t save the email. Please try again.')
      setContactSaved(body.contact.email)
      setContactMsg('Saved.')
    } catch (err) {
      setContactMsg(err instanceof Error ? err.message : 'Couldn’t save the email. Please try again.')
    } finally {
      setWorking(null)
    }
  }

  async function clearContactEmail() {
    setContactMsg('')
    setWorking('contact')
    try {
      const res = await fetch('/api/account/contact', { method: 'DELETE' })
      if (!res.ok) throw new Error('Couldn’t remove the email. Please try again.')
      setContactSaved(null)
      setContactEmail('')
      setContactMsg('Removed.')
    } catch (err) {
      setContactMsg(err instanceof Error ? err.message : 'Couldn’t remove the email. Please try again.')
    } finally {
      setWorking(null)
    }
  }

  async function disconnectStrava() {
    setError('')
    setWorking('strava')
    try {
      const res = await fetch('/att/api/strava/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Couldn’t disconnect Strava. Please try again.')
      setStrava({ connected: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t disconnect Strava. Please try again.')
    } finally {
      setWorking(null)
    }
  }

  async function toggleAutoImport(enabled: boolean) {
    // Optimistic: reflect the choice immediately, revert on failure.
    setStrava(s => (s?.connected ? { ...s, autoImport: enabled } : s))
    try {
      const res = await fetch('/att/api/strava/auto-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Couldn’t change auto-import. Please try again.')
    } catch (err) {
      setStrava(s => (s?.connected ? { ...s, autoImport: !enabled } : s))
      setError(err instanceof Error ? err.message : 'Couldn’t change auto-import. Please try again.')
    }
  }

  async function downloadExport() {
    setError('')
    setWorking('export')
    try {
      // The file is prepared on the server and fetched from a short-lived link:
      // sent straight back, a well-used account's file was over what the server
      // can return in one answer, and the download failed.
      const res = await fetch('/api/account/export', { method: 'POST' })
      const url = res.ok ? ((await res.json()) as { url?: string }).url : undefined
      if (!url) throw new Error('Couldn’t prepare your download. Please try again.')
      window.location.assign(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t prepare your download. Please try again.')
    } finally {
      setWorking(null)
    }
  }

  // Deleting needs a recent real sign-in: ask first, so nobody types DELETE for nothing.
  async function openDelete() {
    setDeleteError('')
    setDeleteStep('checking')
    try {
      const res = await fetch('/api/account')
      if (!res.ok) throw new Error()
      const body = await res.json()
      setDeleteStep(body.recentSignIn ? 'confirm' : 'signin')
    } catch {
      setDeleteError('Couldn’t check your sign-in. Please try again.')
      setDeleteStep('closed')
    }
  }

  // Sign out, then sign in again the way this account does, and come back here.
  async function signInAgain(then: 'delete' | 'strava' | 'google') {
    if (!user) return
    const setErr = then === 'delete' ? setDeleteError : then === 'google' ? setGoogleSignInError : setStravaSignInError
    setErr('')
    // Made through Strava, and Strava is off: signing out would leave no way back in.
    if (!STRAVA && isSyntheticStravaEmail(user.email)) {
      setErr('Strava sign-in is off for now, so you can’t sign in again here. Report an issue asking us to delete your account. We’ll know it’s yours, so leave out your name and email: reports are public.')
      return
    }
    setWorking(then === 'delete' ? 'delete' : then === 'google' ? 'google' : 'strava')
    const back = then === 'delete' ? '/account?resume=delete#delete' : then === 'google' ? '/account#google' : '/account#strava'
    const out = await fetch('/att/api/auth/logout', { method: 'POST' }).catch(() => null)
    if (!out?.ok) {
      setErr('Couldn’t start signing in again. Please try again.')
      setWorking(null)
      return
    }
    // A full page load either way: the header's user came with the page.
    window.location.assign(isSyntheticStravaEmail(user.email)
      ? `/att/api/auth/strava/init?next=${encodeURIComponent(back)}`
      : `/signin?reason=reauth_${then}&next=${encodeURIComponent(back)}`)
  }

  async function deleteAccount() {
    setDeleteError('')
    setWorking('delete')
    try {
      const res = await fetch('/api/account', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // The 10 minutes ran out while they typed: ask them to sign in again here.
        if (body.reauth) { setDeleteStep('signin'); setConfirmText(''); setWorking(null); return }
        throw new Error(body.error ?? 'Couldn’t delete your account. Please try again.')
      }
      // Account gone. Send them home, in full: the header's user came with the page.
      window.location.replace('/att')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Couldn’t delete your account. Please try again.')
      setWorking(null)
    }
  }

  const msgClass = 'text-sm text-muted'

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />

      <Page>
        {user === undefined && <LoadingState className="py-16" />}

        {user === null && (
          <>
            <PageHeader title="Account" />
            <EmptyState
              title="Sign in to see your account"
              body="Sign in to view or manage your account data."
              action={<Link href="/signin?next=/account" className={buttonClass('primary')}>Sign in</Link>}
            />
          </>
        )}

        {user && (
          <>
            <PageHeader title="Account" />

            {/* In-page jump list, from sm up: the page is long. */}
            <nav aria-label="On this page" className="hidden sm:flex flex-wrap gap-x-5 gap-y-1 text-sm -mt-4">
              {SECTIONS.filter(([id]) => (id !== 'strava' || STRAVA || strava?.connected) && (id !== 'google' || GOOGLE_SIGNIN)).map(([id, label]) => (
                <a key={id} href={`#${id}`} className="text-muted hover:text-fg">{label}</a>
              ))}
            </nav>

            {error && (
              <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-sm text-red">
                {error}
              </p>
            )}

            <section id="details" className="flex flex-col gap-3 scroll-mt-4">
              <h2 className="text-lg font-semibold text-fg">Your details</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1 sm:gap-y-3 text-base">
                <dt className="text-sm text-muted">Email</dt>
                <dd className="text-fg tabular break-all mb-2 sm:mb-0">{user.email}</dd>
                <dt className="text-sm text-muted">Display name</dt>
                <dd className="text-fg mb-2 sm:mb-0">{user.displayName}</dd>
                {/* For support: the one id we can look an account up by. */}
                <dt className="text-sm text-muted">Support ID</dt>
                <dd className="text-sm text-muted tabular break-all">{user.id}</dd>
              </dl>

              {/* Contact email — only shown to Strava-only accounts (those
                  with a synthesised email). Email-and-password users already
                  have a real email and don't need this. */}
              {isSyntheticStravaEmail(user.email) && (
                <form onSubmit={saveContactEmail} className="flex flex-col gap-3 pt-2">
                  <Field
                    label="Contact email"
                    htmlFor="contact-email"
                    help="You signed in with Strava, which doesn't share your email. Add one so we can tell you about your account, invitations and changes to our Terms. We never share it."
                  >
                    <input
                      id="contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                      placeholder="you@example.com"
                      className={`${inputClass} sm:max-w-sm`}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={working === 'contact' || !contactEmail.trim()}
                      className={buttonClass('secondary')}
                    >
                      {working === 'contact' ? 'Saving…' : (contactSaved ? 'Update' : 'Save')}
                    </button>
                    {contactSaved && (
                      <button type="button" onClick={clearContactEmail} disabled={working === 'contact'} className={buttonClass('quiet')}>
                        Remove
                      </button>
                    )}
                  </div>
                  {contactMsg && <p className={msgClass}>{contactMsg}</p>}
                </form>
              )}
            </section>

            <section id="profile" className="flex flex-col gap-3 scroll-mt-4">
              <h2 className="text-lg font-semibold text-fg">Public profile</h2>
              <p className="text-base text-muted">
                Show your race results and personal bests on a public page. Private and group-only
                results stay hidden. Off until you turn it on.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => toggleProfilePublic(!profilePublic)}
                  disabled={profilePublic === undefined || profileSaving}
                  className={buttonClass('secondary')}
                >
                  {profileSaving
                    ? 'Saving…'
                    : profilePublic
                      ? 'Make profile private'
                      : 'Make profile public'}
                </button>
                <Link href={`/profile/${handle ?? user.id}`} className="tt-link text-sm">
                  {profilePublic ? 'View my profile →' : 'Preview my profile →'}
                </Link>
              </div>

              {/* Vanity handle */}
              <div className="flex flex-col gap-3 pt-2">
                <Field
                  label="Profile handle"
                  htmlFor="profile-handle"
                  help={<>A short link like <span className="text-fg tabular">/profile/{handle || 'your-handle'}</span>. Lowercase letters, numbers and hyphens, 3–30 characters.</>}
                >
                  <input
                    id="profile-handle"
                    type="text"
                    value={handleInput}
                    onChange={e => setHandleInput(e.target.value)}
                    placeholder="your-handle"
                    autoCapitalize="none"
                    autoCorrect="off"
                    className={`${inputClass} sm:max-w-sm`}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveHandle}
                    disabled={handleSaving || !handleInput.trim() || handleInput.trim() === handle}
                    className={buttonClass('secondary')}
                  >
                    {handleSaving ? 'Saving…' : handle ? 'Change' : 'Save'}
                  </button>
                  {handle && (
                    <button type="button" onClick={releaseHandle} disabled={handleSaving} className={buttonClass('quiet')}>
                      Remove
                    </button>
                  )}
                </div>
                {handleMsg && <p className={msgClass}>{handleMsg}</p>}
              </div>
            </section>

            {GOOGLE_SIGNIN && (
              <>
                <GoogleConnect onSignInAgain={() => signInAgain('google')} signingIn={working === 'google'} />
                {googleSignInError && <p role="alert" className="text-sm text-red -mt-3">{googleSignInError}</p>}
              </>
            )}

            {/* Strava switched off: shown only to people still connected, so they can disconnect. */}
            {(STRAVA || strava?.connected) && (
            <section id="strava" className="flex flex-col gap-3 scroll-mt-4">
              <h2 className="text-lg font-semibold text-fg">Strava</h2>
              {STRAVA && (
                <p className="text-base text-muted">
                  Connect Strava to bring in your paddles and trial results without exporting files,
                  and to sign in with Strava. We only read your activities; we never post.
                </p>
              )}

              {stravaFlash && (
                <p
                  role={stravaFlash.tone === 'err' ? 'alert' : 'status'}
                  className={`rounded-control border px-3 py-2 text-sm ${
                    stravaFlash.tone === 'ok'
                      ? 'border-green/50 bg-green/10 text-green'
                      : 'border-red/50 bg-red/10 text-red'
                  }`}
                >
                  {stravaFlash.text}
                </p>
              )}
              {stravaFlashKey === 'reauth' && (
                <div className="rounded-control border border-border bg-surface p-4 flex flex-col gap-3">
                  <p role="status" className="text-sm text-fg">
                    For your safety, connecting Strava needs a recent sign-in. Sign in again and you’ll come straight back here.
                  </p>
                  {stravaSignInError && <p role="alert" className="text-sm text-red">{stravaSignInError}</p>}
                  <div>
                    <button type="button" onClick={() => signInAgain('strava')} disabled={working === 'strava'} className={buttonClass('secondary')}>
                      {working === 'strava' ? 'Sign in again…' : 'Sign in again'}
                    </button>
                  </div>
                </div>
              )}

              {strava === undefined && <p className={msgClass}>Checking…</p>}

              {strava && !strava.connected && STRAVA && (
                <div><StravaButton href="/att/api/strava/connect" post /></div>
              )}

              {strava && strava.connected && (
                <>
                  <div className={`${cardClass} flex items-center justify-between gap-4 px-4 py-2`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {STRAVA ? <Badge tone="green">Connected</Badge> : <Badge>Paused</Badge>}
                      <span className="text-base text-fg truncate">{strava.athlete.name}</span>
                    </div>
                    {/* Strava off: an account made through Strava keeps its link, its only way back in once Strava returns. */}
                    {(STRAVA || !isSyntheticStravaEmail(user.email)) && (
                      <button
                        type="button"
                        onClick={disconnectStrava}
                        disabled={working === 'strava'}
                        className={buttonClass('quiet')}
                      >
                        {working === 'strava' ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    )}
                  </div>
                  {!STRAVA && <p className={msgClass}>Strava isn’t available right now. Paddles you already brought in stay here.</p>}
                  {STRAVA && (<>
                  {/* Auto-import toggle (default on). New water-sport activities
                      flow into Paddles automatically via the Strava webhook. */}
                  <label className={`${cardClass} flex items-center justify-between gap-4 px-4 py-3 cursor-pointer`}>
                    <span>
                      <span className="block text-base text-fg">Auto-import new paddles</span>
                      <span className="block text-sm text-muted">
                        New kayak, canoe, rowing and SUP activities on Strava appear in Paddles by themselves.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="accent-primary w-5 h-5 shrink-0"
                      checked={strava.autoImport}
                      onChange={e => toggleAutoImport(e.target.checked)}
                    />
                  </label>
                  {/* Older paddles (#415): the last month by itself, then further back on request. */}
                  <StravaFirstImport />
                  <StravaMoreImport />
                  {/* Attribution: this row shows the athlete's Strava profile name. */}
                  <PoweredByStrava />
                  </>)}
                  {STRAVA && (
                    <p className={msgClass}>
                      You can also sign in with Strava. Disconnecting stops both importing and signing in
                      with Strava.
                    </p>
                  )}
                </>
              )}
            </section>
            )}

            <section id="devices" className="flex flex-col gap-3 scroll-mt-4">
              <h2 className="text-lg font-semibold text-fg">Devices</h2>
              <Link href="/devices" className={`${cardLinkClass} flex items-center justify-between gap-4 px-4 py-3`}>
                <span>
                  <span className="block text-base text-fg">Your trackers</span>
                  <span className="block text-sm text-muted">Add, remove and see your paddlesnitch trackers.</span>
                </span>
                <Chevron />
              </Link>
            </section>

            <section id="data" className="flex flex-col gap-3 scroll-mt-4">
              <h2 className="text-lg font-semibold text-fg">Your data</h2>
              <p className="text-base text-muted">
                Download everything we hold about you as a JSON file: your account, paddles and diary
                notes, trials, courses and results, groups, and trackers. This is your right of access
                (UK GDPR Art. 15) and to data portability (Art. 20).
              </p>
              <div>
                <button
                  type="button"
                  onClick={downloadExport}
                  disabled={working === 'export'}
                  className={buttonClass('secondary')}
                >
                  {working === 'export' ? 'Preparing…' : 'Download my data'}
                </button>
              </div>
              <p className={msgClass}>
                See the <Link href="/privacy" className="tt-link">privacy policy</Link> for what we hold
                and why. For anything else, email{' '}
                <a href="mailto:privacy@paddlesnitch.com" className="tt-link">privacy@paddlesnitch.com</a>.
              </p>
            </section>

            <section id="delete" className="flex flex-col gap-3 border-t border-border pt-8 scroll-mt-4">
              <h2 className="text-lg font-semibold text-fg">Delete account</h2>
              <p className="text-sm text-muted">
                Deletes your account, your paddles and diary notes, your results (leaderboards update
                without you), your shared links and your tracker recordings. Courses and trials you created
                go too, unless a group owns them or someone else has a result in them. Your trackers are unlinked and Strava is disconnected. A group you own passes
                to one of its admins or members. <strong className="text-fg">This happens at once and can&apos;t be undone.</strong> This
                is your right to erasure (UK GDPR Art. 17).
              </p>
              {deleteError && <p role="alert" className="text-sm text-red">{deleteError}</p>}

              {deleteStep === 'closed' || deleteStep === 'checking' ? (
                <div>
                  <button type="button" onClick={openDelete} disabled={deleteStep === 'checking'} className={buttonClass('danger')}>
                    Delete my account
                  </button>
                </div>
              ) : deleteStep === 'signin' ? (
                <div className="rounded-control border border-border bg-surface p-4 flex flex-col gap-3">
                  <p role="status" className="text-sm text-fg">
                    For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back here.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" autoFocus onClick={() => signInAgain('delete')} disabled={working === 'delete'} className={buttonClass('secondary')}>
                      {working === 'delete' ? 'Sign in again…' : 'Sign in again'}
                    </button>
                    <button type="button" onClick={() => setDeleteStep('closed')} className={buttonClass('secondary')}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-control border border-red/50 bg-red/5 p-4 flex flex-col gap-3">
                  <Field label={<>Type <strong>DELETE</strong> to confirm. There is no undo.</>} htmlFor="confirm-delete">
                    <input
                      id="confirm-delete"
                      type="text"
                      value={confirmText}
                      onChange={e => setConfirmText(e.target.value)}
                      className={inputClass}
                      autoComplete="off"
                      autoFocus
                    />
                  </Field>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={deleteAccount}
                      disabled={confirmText !== 'DELETE' || working === 'delete'}
                      className={buttonClass('danger', 'md', 'bg-red/10')}
                    >
                      {working === 'delete' ? 'Deleting…' : 'Delete for good'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeleteStep('closed'); setConfirmText('') }}
                      disabled={working === 'delete'}
                      className={buttonClass('secondary')}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </Page>
    </main>
  )
}
