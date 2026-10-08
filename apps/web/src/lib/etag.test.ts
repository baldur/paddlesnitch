import { describe, it, expect } from 'vitest'
import { etagMatches } from './etag'

describe('etagMatches', () => {
  it('matches the tag we sent', () => expect(etagMatches('"abc"', '"abc"')).toBe(true))
  it('matches a tag weakened on the way (W/), as HTTP requires', () => expect(etagMatches('W/"abc"', '"abc"')).toBe(true))
  it('matches one of several, and *', () => {
    expect(etagMatches('"x", W/"abc"', '"abc"')).toBe(true)
    expect(etagMatches('*', '"abc"')).toBe(true)
  })
  it('does not match another version, or nothing', () => {
    expect(etagMatches('"abd"', '"abc"')).toBe(false)
    expect(etagMatches(null, '"abc"')).toBe(false)
    expect(etagMatches('', '"abc"')).toBe(false)
  })
})
