import { describe, it, expect } from 'vitest'
import { withTimeout } from './llm'

// Guards the "analysis failed, but works on retry" symptom (#171): a slow/hanging
// LLM backend must not stall the analyse request — it resolves to null so the
// deterministic template stands in, rather than blowing the platform timeout.
describe('withTimeout', () => {
  it('resolves the value when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('insight'), 1000)).resolves.toBe('insight')
  })

  it('resolves null when the promise takes longer than the timeout', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('too late'), 50))
    await expect(withTimeout(slow, 5)).resolves.toBeNull()
  })

  it('resolves null when the underlying call rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('bedrock throttled')), 1000)).resolves.toBeNull()
  })
})
