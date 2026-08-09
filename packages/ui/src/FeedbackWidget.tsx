'use client'
import { useEffect, useState } from 'react'

// The ONE "Report an issue" widget for the whole platform (att + Analyse),
// replacing att's FeedbackTrigger + FeedbackWidget and Analyse's own copy. It's
// theme-aware (semantic token classes only, so it renders correctly in whatever
// palette the host app defines) and posts to the shared ATT feedback endpoint —
// both apps sit behind one CloudFront origin, so an absolute-path fetch reaches
// the ATT server that files the GitHub issue (one GitHub token, one place).
//
// Two entry points: a floating button, AND a window event so a header link can
// open it: `window.dispatchEvent(new CustomEvent('paddlesnitch:open-feedback'))`.
// Anti-bot fields (`website` honeypot + `elapsedMs` time-trap) match
// apps/att/src/lib/anti-bot.ts.

const OPEN_EVENT = 'paddlesnitch:open-feedback'

export default function FeedbackWidget({ endpoint = '/att/api/feedback' }: { endpoint?: string }) {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [issueUrl, setIssueUrl] = useState('')
  const [website, setWebsite] = useState('')
  const [openedAt, setOpenedAt] = useState(0)

  useEffect(() => { if (open) setOpenedAt(Date.now()) }, [open])

  // Open on the platform event (header "REPORT" link) + close on Escape.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const reset = () => { setDescription(''); setEmail(''); setStatus('idle'); setError(''); setIssueUrl(''); setWebsite('') }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'sending') return
    setStatus('sending'); setError('')
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description, email,
          url: window.location.href,
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          website,
          elapsedMs: openedAt ? Date.now() - openedAt : 0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not file the report')
      setIssueUrl(data?.url ?? ''); setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file the report'); setStatus('error')
    }
  }

  // z-indexes clear Leaflet's panes (z-200..z-800) + controls.
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Report an issue"
        className="fixed bottom-4 right-4 z-[1100] border border-border bg-surface shadow-md px-3 py-2 text-xs text-muted tracking-widest hover:border-primary hover:text-fg transition-colors">
        REPORT AN ISSUE
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[1500] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
      <div className="bg-surface border border-border w-full sm:max-w-md sm:shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="border-b border-border px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-fg tracking-widest">REPORT AN ISSUE</span>
          <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg text-sm" aria-label="Close">✕</button>
        </header>

        {status === 'done' ? (
          <div className="flex flex-col gap-4 px-4 py-6 text-sm">
            <p className="text-green">Thanks — your report has been filed.</p>
            {issueUrl && (
              <p className="text-xs text-muted">Tracked at{' '}
                <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{issueUrl.replace(/^https?:\/\//, '')}</a>
              </p>
            )}
            <button type="button" onClick={() => { reset(); setOpen(false) }} className="self-end px-4 py-2 bg-primary text-white text-xs tracking-widest hover:opacity-90 transition-opacity">CLOSE</button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-4">
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted tracking-widest">WHAT WENT WRONG?</label>
              <textarea required minLength={10} maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} rows={5} autoFocus
                placeholder="A short description helps. What were you doing when this happened?"
                className="bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors resize-y" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted tracking-widest">EMAIL (OPTIONAL)</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="So we can follow up if needed"
                className="bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors" />
            </div>
            {error && <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">{error}</div>}
            <p className="text-xs text-muted">We&apos;ll automatically include the page you&apos;re on, your browser, and (if signed in) your account name — so you don&apos;t need to repeat it.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} disabled={status === 'sending'} className="px-4 py-2 border border-border text-muted text-xs tracking-widest hover:bg-surface-2 transition-colors">CANCEL</button>
              <button type="submit" disabled={status === 'sending' || description.trim().length < 10} className="px-4 py-2 bg-primary text-white text-xs tracking-widest hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity">{status === 'sending' ? 'SENDING…' : 'SEND REPORT'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
