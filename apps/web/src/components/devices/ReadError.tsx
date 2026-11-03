'use client'
import { useEffect, useRef } from 'react'
import { Button } from '@paddlesnitch/ui/Button'

// A recording that couldn't be read, with Try again. After a retry that fails
// again, focus comes back here: the button the reader pressed was unmounted
// by the loading state, which would leave focus on the page's body.
export default function ReadError({ onRetry, retried }: { onRetry: () => void; retried: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (retried) ref.current?.focus() }, [retried])
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col items-start gap-3 outline-none">
      <p className="text-base text-red" role="alert">Couldn’t read this recording.</p>
      <Button variant="secondary" onClick={onRetry}>Try again</Button>
    </div>
  )
}
