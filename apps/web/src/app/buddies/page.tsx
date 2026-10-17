'use client'
import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDay } from '@paddlesnitch/core/format'
import AppHeader from '@/components/AppHeader'
import { trpc } from '@/lib/trpc'

// BUDDIES (docs/features/buddies-and-compare.md): the people who see your
// paddles and whose paddles you see. Mutual: a request, accepted; or your
// invite link, opened. Either of you can remove the other.

const H2 = 'text-xs text-muted tracking-[0.2em] uppercase mb-2'
const ROW = 'border border-border px-4 py-3 flex items-center justify-between gap-3'
const BTN = 'text-xs tracking-widest px-3 py-1.5 border border-border hover:border-primary disabled:opacity-40'

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

  const d = q.data
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<span className="text-fg text-sm">BUDDIES</span>} />
      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full flex flex-col gap-8">
        <div>
          <h1 className="text-lg font-bold tracking-widest">BUDDIES</h1>
          <p className="text-sm text-muted mt-1">Buddies see each other&apos;s paddles and can compare lines with them. Add someone with your invite link, or from their profile.</p>
        </div>

        {inviteMsg && <p role="status" className="border border-primary px-4 py-3 text-sm">{inviteMsg}</p>}
        {q.isError && <p role="alert" className="text-sm text-red">Couldn&apos;t load your buddies. Please try again.</p>}

        {d && d.incoming.length > 0 && (
          <section aria-label="Requests">
            <h2 className={H2}>Asking to be your buddy</h2>
            <div className="flex flex-col gap-2">
              {d.incoming.map(r => (
                <div key={r.userId} className={ROW}>
                  <span className="text-sm">{r.name}</span>
                  <span className="flex gap-2">
                    <button type="button" className={`${BTN} bg-primary text-white border-primary`} disabled={accept.isPending} onClick={() => accept.mutate({ userId: r.userId })}>ACCEPT</button>
                    <button type="button" className={BTN} disabled={decline.isPending} onClick={() => decline.mutate({ userId: r.userId })}>DECLINE</button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Your buddies">
          <h2 className={H2}>Your buddies</h2>
          {!d ? <p className="text-sm text-muted">Loading…</p>
            : d.buddies.length === 0 ? <p className="border border-border px-4 py-6 text-sm text-muted">No buddies yet. Send your invite link to someone you paddle with.</p>
            : (
              <div className="flex flex-col gap-2">
                {d.buddies.map(b => (
                  <div key={b.userId} className={ROW}>
                    <span className="min-w-0">
                      <span className="block text-sm">{b.name}</span>
                      <span className="block text-xs text-muted">buddies since {fmtDay(b.since)}</span>
                    </span>
                    {confirming !== b.userId && <Link href={`/buddies/${b.userId}`} className="text-xs tracking-widest text-primary-text ml-auto">PADDLES →</Link>}
                    {confirming === b.userId ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-muted">Stop seeing each other&apos;s paddles?</span>
                        <button type="button" className={`${BTN} text-red`} onClick={() => { remove.mutate({ userId: b.userId }); setConfirming(null) }}>REMOVE</button>
                        <button type="button" className={BTN} onClick={() => setConfirming(null)}>KEEP</button>
                      </span>
                    ) : (
                      <button type="button" className={BTN} onClick={() => setConfirming(b.userId)}>REMOVE</button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </section>

        {d && d.outgoing.length > 0 && (
          <section aria-label="Waiting for an answer">
            <h2 className={H2}>Waiting for an answer</h2>
            <div className="flex flex-col gap-2">
              {d.outgoing.map(r => (
                <div key={r.userId} className={ROW}>
                  <span className="text-sm">{r.name}</span>
                  <button type="button" className={BTN} disabled={cancel.isPending} onClick={() => cancel.mutate({ userId: r.userId })}>CANCEL</button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Your invite link">
          <h2 className={H2}>Your invite link</h2>
          <div className="border border-border bg-surface px-4 py-3 flex flex-col gap-2">
            <code className="text-xs break-all">{link || 'Loading…'}</code>
            <span className="flex gap-2">
              <button type="button" className={`${BTN} bg-primary text-white border-primary`} disabled={!link} onClick={copy}>{copied ? 'COPIED' : 'COPY'}</button>
              <button type="button" className={BTN} disabled={newInvite.isPending} onClick={() => { setCopied(false); newInvite.mutate() }}>NEW LINK</button>
            </span>
            <p className="text-xs text-muted">Anyone signed in who opens it becomes your buddy. A new link stops the old one working.</p>
          </div>
        </section>

        {d && (
          <section aria-label="Sharing">
            <h2 className={H2}>Sharing</h2>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={d.sharing.paddles} disabled={sharing.isPending}
                onChange={e => sharing.mutate({ paddles: e.target.checked })} />
              Buddies can see my paddles
            </label>
            <p className="text-xs text-muted mt-1">They never see your notes. To hide one paddle, open it in <Link href="/paddles" className="text-primary-text">Paddles</Link>.</p>
          </section>
        )}
      </div>
    </main>
  )
}
