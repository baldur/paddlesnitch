'use client'
import { useEffect, useState } from 'react'
import { buttonClass } from './Button'
import { Field, inputClass } from './Form'

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
// apps/web/src/lib/anti-bot.ts.

const OPEN_EVENT = 'paddlesnitch:open-feedback'

// A plain button anywhere on the page (the footer, an error page) that opens
// the widget. On phones it's the way in: the floating button is hidden there
// because it covered form fields and content.
export function ReportIssueButton({ className, children = 'Report an issue' }: { className?: string; children?: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}>
      {children}
    </button>
  )
}

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

  // Read the fields from the form itself, not only React state: autofill and
  // automation can fill a field without React's onChange firing (#507).
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (status === 'sending') return
    const form = new FormData(e.currentTarget)
    const description = String(form.get('description') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    if (!description) { setError('Please describe what went wrong.'); setStatus('error'); return }
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
      if (!res.ok) throw new Error(data?.error ?? 'Couldn’t send your report. Please try again.')
      // Only a filed issue counts as sent. A 200 without one (the anti-bot
      // drop) means nothing reached us.
      if (typeof data?.url !== 'string' || !data.url) throw new Error('Your report wasn’t sent. Please try again.')
      setIssueUrl(data.url); setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send your report. Please try again.'); setStatus('error')
    }
  }

  // z-indexes clear Leaflet's panes (z-200..z-800) + controls. Desktop only:
  // on a phone it sat on top of fields and buttons, so phones use the footer's
  // ReportIssueButton (and signed-in users the account menu) instead.
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Report an issue"
        className="hidden sm:block fixed bottom-4 right-4 z-[1100] rounded-control border border-border-strong bg-surface shadow-md px-3 py-2 text-sm text-muted hover:text-fg hover:bg-surface-2 transition-colors">
        Report an issue
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[1500] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="feedback-title"
        className="bg-surface border border-border w-full sm:max-w-md rounded-t-sheet sm:rounded-sheet shadow-xl flex flex-col pb-[env(safe-area-inset-bottom,0px)]"
        onClick={e => e.stopPropagation()}>
        <header className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
          <h2 id="feedback-title" className="text-lg font-semibold text-fg">Report an issue</h2>
          <button type="button" onClick={() => setOpen(false)} className={`${buttonClass('quiet')} -mr-2 w-11 px-0`} aria-label="Close">✕</button>
        </header>

        {status === 'done' ? (
          <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
            <p className="text-base text-green">Thanks, your report has been sent.</p>
            {issueUrl && (
              <p className="text-sm text-muted">You can follow it at{' '}
                <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="text-primary-text underline break-all">{issueUrl.replace(/^https?:\/\//, '')}</a>
              </p>
            )}
            <button type="button" onClick={() => { reset(); setOpen(false) }} className={buttonClass('primary', 'md', 'self-end')}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4 pt-2">
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
            </div>
            <Field label="What went wrong?" htmlFor="feedback-description">
              <textarea id="feedback-description" name="description" required minLength={10} maxLength={5000} onInput={e => setDescription(e.currentTarget.value)} rows={5} autoFocus
                placeholder="What were you doing when it happened?"
                className={`${inputClass} py-2 resize-y`} />
            </Field>
            <Field label="Email (optional)" htmlFor="feedback-email" help="So we can follow up.">
              <input id="feedback-email" name="email" type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            </Field>
            {error && <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}
            <p className="text-sm text-muted">Reports are posted publicly on GitHub, so don&apos;t include personal details. We add the page and your browser. Your name and email stay private.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} disabled={status === 'sending'} className={buttonClass('quiet')}>Cancel</button>
              <button type="submit" disabled={status === 'sending' || description.trim().length < 10} className={buttonClass('primary')}>{status === 'sending' ? 'Sending…' : 'Send report'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
