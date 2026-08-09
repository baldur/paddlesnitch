import { describe, it, expect } from 'vitest'
import { paddleFingerprint } from './analysis-store'

describe('paddleFingerprint', () => {
  it('is identical for the same paddle re-submitted', () => {
    const a = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834.2, 6.512)
    const b = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834.2, 6.512)
    expect(a).toBe(b)
  })

  it('absorbs sub-second / sub-metre float noise between re-analyses', () => {
    const a = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834.2, 6.51204)
    const b = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834.4, 6.51199)
    expect(a).toBe(b)
  })

  it('differs when the start time differs', () => {
    const a = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834, 6.5)
    const b = paddleFingerprint('2026-08-09T11:00:00.000Z', 1834, 6.5)
    expect(a).not.toBe(b)
  })

  it('differs when duration differs by more than a second', () => {
    const a = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834, 6.5)
    const b = paddleFingerprint('2026-08-09T10:00:00.000Z', 1840, 6.5)
    expect(a).not.toBe(b)
  })

  it('differs when distance differs by more than a metre', () => {
    const a = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834, 6.5)
    const b = paddleFingerprint('2026-08-09T10:00:00.000Z', 1834, 6.7)
    expect(a).not.toBe(b)
  })
})
