import { describe, it, expect } from 'vitest'
import { looksLikeBot, MIN_ELAPSED_MS } from './anti-bot'

describe('looksLikeBot', () => {
  it('passes a real submission: empty honeypot, slow enough', () => {
    expect(looksLikeBot({ website: '', elapsedMs: MIN_ELAPSED_MS + 1 })).toBe(false)
  })

  it('flags a populated honeypot even when slow', () => {
    expect(looksLikeBot({ website: 'http://spam.example', elapsedMs: 10_000 })).toBe(true)
  })

  it('flags a submission faster than the time threshold', () => {
    expect(looksLikeBot({ website: '', elapsedMs: MIN_ELAPSED_MS - 1 })).toBe(true)
  })

  it('flags a submission with no timing field (treated as instant)', () => {
    expect(looksLikeBot({ website: '' })).toBe(true)
  })

  it('flags a submission with no fields at all (a bare API POST)', () => {
    expect(looksLikeBot({})).toBe(true)
  })

  it('ignores a whitespace-only honeypot', () => {
    expect(looksLikeBot({ website: '   ', elapsedMs: 5_000 })).toBe(false)
  })
})
