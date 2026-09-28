import { describe, it, expect } from 'vitest'
import { sourceLabel } from '@paddlesnitch/core/paddles'

describe('sourceLabel', () => {
  it.each([
    ['strava', ' · STRAVA'],
    ['trial', ' · TIME TRIAL'],
    ['device', ' · TRACKER'],
    ['file', ''],
    [undefined, ''],
  ])('%s → %j', (type, expected) => {
    expect(sourceLabel(type)).toBe(expected)
  })
})
