// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useMountedAt } from './use-mounted-at'

describe('useMountedAt', () => {
  it('holds when the form appeared, set after mount (not during render)', async () => {
    let ref: { current: number } | null = null
    function Form() { ref = useMountedAt(); return null }
    const before = Date.now()
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<Form />) })
    expect(ref!.current).toBeGreaterThanOrEqual(before)
    expect(ref!.current).toBeLessThanOrEqual(Date.now())
    await act(async () => { root.unmount() })
  })
})
