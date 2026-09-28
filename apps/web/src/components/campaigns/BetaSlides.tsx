'use client'
import { useEffect, useRef, useState } from 'react'
import BetaApplyModal from './BetaApplyModal'

export type Slide = { title: string; body: string; image?: { src: string; alt: string } }

// One message at a time, flipped with the arrows at the sides, the dots, the
// keyboard arrow keys, or a swipe. Every slide is in the HTML (inactive ones are
// `hidden`), so the page reads fine without JavaScript and to search engines.
// On the last slide the CLICK TO SNITCH button starts bouncing.
export default function BetaSlides({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0)
  const last = slides.length - 1
  const touchStart = useRef<{ x: number; y: number } | null>(null)
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

  // Beside the card from sm: up; on a phone they sit over the card's edges so the
  // card gets the full width (beside it, a 320 px screen left ~5 words a line).
  const arrow = 'z-10 shrink-0 w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center border border-border bg-bg/90 text-fg text-lg hover:border-primary disabled:opacity-30 disabled:hover:border-border transition-colors absolute top-1/2 -translate-y-1/2 sm:static sm:translate-y-0'

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative flex items-center sm:gap-3 w-full max-w-xl">
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous" className={`${arrow} left-1`}>←</button>

        <div
          className="flex-1"
          aria-roledescription="carousel"
          onTouchStart={e => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
          onTouchEnd={e => {
            const start = touchStart.current
            touchStart.current = null
            if (!start) return
            const dx = e.changedTouches[0].clientX - start.x
            const dy = e.changedTouches[0].clientY - start.y
            // Only a mainly-sideways swipe flips; a page scroll that drifts
            // sideways must not.
            if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
            go(dx < 0 ? i + 1 : i - 1)
          }}
        >
          {slides.map((s, n) => (
            <article
              key={s.title}
              hidden={n !== i}
              aria-roledescription="slide"
              aria-label={`${n + 1} of ${slides.length}`}
              className={`sm:aspect-square border bg-bg/80 backdrop-blur-sm px-14 py-8 sm:p-8 flex flex-col justify-center gap-3 ${n === 0 ? 'border-primary' : 'border-border'}`}
            >
              {n === 0
                ? <h1 className="text-2xl sm:text-3xl font-bold text-fg leading-tight">{s.title}</h1>
                : <h2 className="text-2xl sm:text-3xl font-bold text-fg leading-tight">{s.title}</h2>}
              {s.image && (
                // eslint-disable-next-line @next/next/no-img-element -- a static public/ file; next/image adds nothing here
                <img src={s.image.src} alt={s.image.alt} loading="lazy" className="w-full border border-border" />
              )}
              <p className="text-sm sm:text-base text-muted leading-relaxed">{s.body}</p>
              {n === last && (
                // Points from the last message down to the (now bouncing) button.
                <span aria-hidden="true" data-testid="down-arrow" className="self-center mt-2 text-3xl text-primary motion-safe:animate-bounce">↓</span>
              )}
            </article>
          ))}
        </div>

        <button type="button" onClick={() => go(i + 1)} disabled={i === last} aria-label="Next" className={`${arrow} right-1`}>→</button>
      </div>

      <div className="flex gap-2" aria-label="Choose a slide">
        {slides.map((s, n) => (
          <button
            key={s.title}
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
