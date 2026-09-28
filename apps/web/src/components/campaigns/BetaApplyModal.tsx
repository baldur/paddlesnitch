'use client'
import { useEffect, useState } from 'react'
import BetaSignupForm from './BetaSignupForm'
import { capture } from '@/lib/analytics'

// The CLICK TO SNITCH button and the pop-up it opens. The form lives in the
// pop-up so the page itself is only the video and the message boxes.
// Closes on ✕, Escape, or a click on the dimmed background.
// `bounce` makes the button bounce (the carousel sets it on its last slide).
export default function BetaApplyModal({ bounce = false }: { bounce?: boolean }) {
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
        onClick={() => { setOpen(true); capture('campaign_cta', { campaign: 'betatesters' }) }}
        className={`px-8 py-3 bg-primary text-white font-bold text-sm tracking-widest hover:opacity-90 transition-opacity ${bounce ? 'motion-safe:animate-bounce' : ''}`}
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
            aria-label="Apply to be a beta tester"
            className="bg-surface border border-border w-full sm:max-w-md max-h-[100svh] overflow-y-auto flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-end px-3 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg text-sm p-2" aria-label="Close">✕</button>
            </div>
            <div className="px-5 pb-5">
              <BetaSignupForm />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
