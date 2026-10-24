// Machine-readable reasons on rejected trial uploads (#515).
import { describe, expect, it } from 'vitest'
import { gateReason, parseFailureReason, UPLOAD_REASONS } from './upload-reasons'

describe('upload rejection reasons', () => {
  it('maps every parse failure to a code', () => {
    expect(parseFailureReason('unknown_format')).toBe('UNKNOWN_FORMAT')
    expect(parseFailureReason('kml_no_timing')).toBe('NO_TIMESTAMPS')
    expect(parseFailureReason('empty')).toBe('EMPTY_TRACK')
    expect(parseFailureReason('parse_error')).toBe('UNREADABLE_FILE')
  })

  it('names the blocking gate and whether it was missed or crossed the wrong way', () => {
    expect(gateReason({ total: 3, gatesPassed: 1, blocking: { gateNumber: 2, requiredDirection: 1, reason: 'not_crossed' } }))
      .toEqual({ reason: 'MISSED_GATE', gate: 2 })
    expect(gateReason({ total: 3, gatesPassed: 1, blocking: { gateNumber: 2, requiredDirection: -1, reason: 'wrong_direction' } }))
      .toEqual({ reason: 'WRONG_DIRECTION', gate: 2 })
    expect(gateReason({ total: 3, gatesPassed: 3, blocking: null })).toEqual({ reason: 'TOO_SHORT' })
  })

  it('codes are unique', () => {
    expect(new Set(UPLOAD_REASONS).size).toBe(UPLOAD_REASONS.length)
  })
})
