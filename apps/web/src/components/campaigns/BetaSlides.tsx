'use client'
import { useEffect, useRef, useState } from 'react'
import BetaApplyModal from './BetaApplyModal'

export type Slide = { eyebrow: string; title: string; body: string }

// One message at a time, flipped with the arrows at the sides, the dots, the
// keyboard arrow keys, or a swipe. Every slide is in the HTML (inactive ones are
// `hidden`), so the page reads fine without JavaScript and to search engines.
// On the last slide the CLICK TO SNITCH button starts bouncing.
export default function BetaSlides({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0)
  const last = slides.length - 1
  const touchX = useRef<number | null>(null)
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave the keys alone while the form pop-up is open.
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'ArrowRight') setI(n => Math.min(last, n + 1))
      if (e.key === 'ArrowLeft') setI(n => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last])

  const arrow = 'shrink-0 w-11 h-11 flex items-center justify-center border border-border bg-bg/80 text-fg text-lg hover:border-primary disabled:opacity-30 disabled:hover:border-border transition-colors'

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-3 w-full max-w-xl">
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous" className={arrow}>←</button>

        <div
          className="flex-1"
          aria-roledescription="carousel"
          onTouchStart={e => { touchX.current = e.touches[0].clientX }}
          onTouchEnd={e => {
            if (touchX.current == null) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (dx < -40) go(i + 1)
            if (dx > 40) go(i - 1)
          }}
        >
          {slides.map((s, n) => (
            <article
              key={s.eyebrow}
              hidden={n !== i}
              aria-roledescription="slide"
              aria-label={`${n + 1} of ${slides.length}`}
              className={`aspect-square border bg-bg/80 backdrop-blur-sm p-6 sm:p-8 flex flex-col justify-center gap-3 ${n === 0 ? 'border-primary' : 'border-border'}`}
            >
              <p className="text-[10px] tracking-[0.3em] uppercase text-muted">{s.eyebrow}</p>
              {n === 0
                ? <h1 className="text-2xl sm:text-3xl font-bold text-fg leading-tight">{s.title}</h1>
                : <h2 className="text-2xl sm:text-3xl font-bold text-fg leading-tight">{s.title}</h2>}
              <p className="text-sm sm:text-base text-muted leading-relaxed">{s.body}</p>
              {n === last && (
                // Points from the last message down to the (now bouncing) button.
                <span aria-hidden="true" data-testid="down-arrow" className="self-center mt-2 text-3xl text-primary motion-safe:animate-bounce">↓</span>
              )}
            </article>
          ))}
        </div>

        <button type="button" onClick={() => go(i + 1)} disabled={i === last} aria-label="Next" className={arrow}>→</button>
      </div>

      <div className="flex gap-2" aria-label="Choose a slide">
        {slides.map((s, n) => (
          <button
            key={s.eyebrow}
            type="button"
            onClick={() => go(n)}
            aria-label={`Show ${n + 1} of ${slides.length}`}
            aria-current={n === i}
            className={`w-2.5 h-2.5 border ${n === i ? 'bg-primary border-primary' : 'border-muted'}`}
          />
        ))}
      </div>

      <BetaApplyModal bounce={i === last} />
    </div>
  )
}
