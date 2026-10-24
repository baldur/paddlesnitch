'use client'
import Link from 'next/link'
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDay } from '@paddlesnitch/core/format'
import AppHeader from '@/components/AppHeader'
import { trpc } from '@/lib/trpc'
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Card, Chevron, EmptyState, cardClass } from '@paddlesnitch/ui/Card'

// BUDDIES (docs/features/buddies-and-compare.md): the people who see your
// paddles and whose paddles you see. Mutual: a request, accepted; or your
// invite link, opened. Either of you can remove the other.

const ROW = 'rounded-control border border-border bg-surface px-4 py-2 min-h-14 flex items-center justify-between gap-3'

const noSubscribe = () => () => {}

export default function BuddiesPage() {
  return <Suspense><Buddies /></Suspense>
}

function Buddies() {
  const utils = trpc.useUtils()
  const q = trpc.buddies.list.useQuery(undefined, { retry: false })
  const invite = trpc.buddies.invite.useQuery(undefined, { retry: false })
  const refresh = () => { utils.buddies.list.invalidate(); utils.buddies.pendingCount.invalidate() }
  const accept = trpc.buddies.accept.useMutation({ onSuccess: refresh })
  const decline = trpc.buddies.decline.useMutation({ onSuccess: refresh })
  const cancel = trpc.buddies.cancel.useMutation({ onSuccess: refresh })
  const remove = trpc.buddies.remove.useMutation({ onSuccess: refresh })
  const newInvite = trpc.buddies.newInvite.useMutation({ onSuccess: () => utils.buddies.invite.invalidate() })
  const sharing = trpc.buddies.setSharing.useMutation({ onSuccess: refresh })
  const [confirming, setConfirming] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Arriving from someone's invite link: become their buddy.
  const token = useSearchParams().get('invite')
  const opened = trpc.buddies.acceptInvite.useMutation({ onSuccess: refresh })
  const asked = useRef(false)
  useEffect(() => {
    if (token && !asked.current) { asked.current = true; opened.mutate({ token }) }
  }, [token, opened])
  const inviteMsg = opened.data && {
    accepted: `You and ${opened.data.name} are now buddies.`,
    already_buddies: `You and ${opened.data.name} are already buddies.`,
    self: "That's your own invite link. Send it to someone you paddle with.",
    invalid: "That invite link doesn't work any more. Ask for a new one.",
  }[opened.data.outcome]

  const link = invite.data && typeof window !== 'undefined' ? `${window.location.origin}/buddies?invite=${invite.data.token}` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { /* the link is on screen */ } }
  // On a phone, the phone's own share sheet (Messages, WhatsApp…); elsewhere,
  // copy. A cancelled share sheet is not an error.
  // Known only in the browser: read after the first render so the server's
  // HTML and the first browser render agree.
  const canShare = useSyncExternalStore(noSubscribe, () => typeof navigator.share === 'function', () => false)
  const share = async () => {
    if (!canShare) return copy()
    try { await navigator.share({ title: 'Be my paddling buddy', text: 'See my paddles and compare lines with me on paddlesnitch.', url: link }) }
    catch { /* cancelled */ }
  }

  const d = q.data
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← Paddles</Link>} />
      <Page>
        <PageHeader title="Buddies" description="Buddies see each other's paddles and can compare lines with them. Add someone with your invite link, or from their profile." />

        {inviteMsg && <p role="status" className={`${cardClass} border-primary px-4 py-3 text-base`}>{inviteMsg}</p>}
        {q.isError && <p role="alert" className="text-base text-red">Couldn&apos;t load your buddies. Please try again.</p>}

        {d && d.incoming.length > 0 && (
          <section aria-label="Requests" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-fg">Asking to be your buddy</h2>
            <ul className="flex flex-col gap-2">
              {d.incoming.map(r => (
                <li key={r.userId} className={ROW}>
                  <span className="text-base text-fg min-w-0 truncate">{r.name}</span>
                  <span className="flex gap-2">
                    <button type="button" className={buttonClass('primary', 'sm')} disabled={accept.isPending} onClick={() => accept.mutate({ userId: r.userId })}>Accept</button>
                    <button type="button" className={buttonClass('quiet', 'sm')} disabled={decline.isPending} onClick={() => decline.mutate({ userId: r.userId })}>Decline</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Your buddies" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-fg">Your buddies</h2>
          {!d ? <LoadingState label="Loading" className="py-6" />
            : d.buddies.length === 0 ? (
              <EmptyState title="No buddies yet" body="Send your invite link to someone you paddle with."
                action={link ? <button type="button" onClick={share} className={buttonClass('primary')}>{canShare ? 'Share invite link' : copied ? 'Copied' : 'Copy invite link'}</button> : undefined} />
            ) : (
              <ul className="flex flex-col gap-2">
                {d.buddies.map(b => (
                  <li key={b.userId} className={cardClass}>
                    {confirming === b.userId ? (
                      <div className="p-3 flex flex-wrap items-center gap-2">
                        <span className="text-base text-fg flex-1 min-w-[12rem]">Stop seeing each other&apos;s paddles with {b.name}?</span>
                        <button type="button" className={buttonClass('danger', 'sm')} onClick={() => { remove.mutate({ userId: b.userId }); setConfirming(null) }}>Remove</button>
                        <button type="button" className={buttonClass('quiet', 'sm')} onClick={() => setConfirming(null)}>Keep</button>
                      </div>
                    ) : (
                      <div className="flex items-center">
                        <Link href={`/buddies/${b.userId}`} className="flex-1 min-w-0 flex items-center gap-3 p-3 rounded-control hover:bg-surface-2 transition-colors">
                          <span className="flex-1 min-w-0">
                            <span className="block text-base text-fg truncate">{b.name}</span>
                            <span className="block text-sm text-muted">Buddies since {fmtDay(b.since)}</span>
                          </span>
                          <span className="text-sm text-primary-text">Paddles</span>
                          <Chevron />
                        </Link>
                        <button type="button" className={buttonClass('quiet', 'sm', 'mr-2')} onClick={() => setConfirming(b.userId)} aria-label={`Remove ${b.name}`}>Remove</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </section>

        {d && d.outgoing.length > 0 && (
          <section aria-label="Waiting for an answer" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-fg">Waiting for an answer</h2>
            <ul className="flex flex-col gap-2">
              {d.outgoing.map(r => (
                <li key={r.userId} className={ROW}>
                  <span className="text-base text-fg min-w-0 truncate">{r.name}</span>
                  <button type="button" className={buttonClass('quiet', 'sm')} disabled={cancel.isPending} onClick={() => cancel.mutate({ userId: r.userId })}>Cancel</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Your invite link" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-fg">Your invite link</h2>
          <Card className="flex flex-col gap-3">
            <code className="font-mono text-sm text-fg break-all bg-bg border border-border rounded-control px-3 py-2">{link || 'Loading…'}</code>
            <div className="flex flex-wrap gap-2">
              {canShare && <button type="button" className={buttonClass('secondary')} disabled={!link} onClick={share}><ShareIcon />Share</button>}
              <button type="button" className={buttonClass('secondary')} disabled={!link} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" className={buttonClass('quiet')} disabled={newInvite.isPending} onClick={() => { setCopied(false); newInvite.mutate() }}>New link</button>
            </div>
            <p className="text-sm text-muted">Anyone signed in who opens it becomes your buddy. A new link stops the old one working.</p>
          </Card>
        </section>

        {d && (
          <section aria-label="Sharing" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-fg">Sharing</h2>
            <label className="flex items-center gap-3 text-base min-h-11 cursor-pointer">
              <input type="checkbox" checked={d.sharing.paddles} disabled={sharing.isPending} className="accent-primary w-5 h-5"
                onChange={e => sharing.mutate({ paddles: e.target.checked })} />
              Buddies can see my paddles
            </label>
            <p className="text-sm text-muted">They never see your notes. To hide one paddle, open it in <Link href="/paddles" className="tt-link">Paddles</Link> and choose Hide from buddies.</p>
          </section>
        )}
      </Page>
    </main>
  )
}

function ShareIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 3v10M6 7l4-4 4 4M4 11v5a1 1 0 001 1h10a1 1 0 001-1v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
