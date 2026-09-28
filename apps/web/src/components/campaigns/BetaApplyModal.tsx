'use client'
import { useEffect, useState } from 'react'
import BetaSignupForm from './BetaSignupForm'

// The CLICK TO SNITCH button and the pop-up it opens. The form lives in the
// pop-up so the page itself is only the video and the message boxes.
// Closes on ✕, Escape, or a click on the dimmed background.
export default function BetaApplyModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'   // no page scroll behind the pop-up
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-8 py-3 bg-primary text-white font-bold text-sm tracking-widest hover:opacity-90 transition-opacity"
      >
        CLICK TO SNITCH
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1500] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="beta-apply-title"
            className="bg-surface border border-border w-full sm:max-w-md max-h-[100svh] overflow-y-auto flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <header className="border-b border-border px-5 py-3 flex items-center justify-between">
              <h2 id="beta-apply-title" className="text-xs text-fg tracking-widest uppercase">Apply to be a beta tester</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg text-sm" aria-label="Close">✕</button>
            </header>
            <div className="px-5 py-5">
              <BetaSignupForm />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
