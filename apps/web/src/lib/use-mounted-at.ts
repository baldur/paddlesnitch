'use client'
import { useEffect, useRef } from 'react'

// When the form appeared, for the anti-bot time trap (lib/anti-bot.ts): send
// `Date.now() - mountedAt.current` as elapsedMs. Set after mount, not during
// render (React requires render to be pure; three forms each did it inline).
export function useMountedAt() {
  const mountedAt = useRef(0)
  useEffect(() => { mountedAt.current = Date.now() }, [])
  return mountedAt
}
