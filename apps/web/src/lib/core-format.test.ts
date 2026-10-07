import { describe, it, expect } from 'vitest'
import { fmtDay, sportLabel, participationLabel } from '@paddlesnitch/core/format'

describe('shared wording for stored values', () => {
  it('writes a day the same way on the server and in the browser', () => {
    expect(fmtDay('2025-04-12')).toBe('12 Apr 2025')
    expect(fmtDay('2025-04-12T23:30:00Z')).toBe('12 Apr 2025')
    expect(fmtDay('not a date')).toBe('not a date')
  })
  it('says what "both" means', () => {
    expect(sportLabel('both')).toBe('KAYAK AND ROWING')
    expect(sportLabel('kayak')).toBe('KAYAK')
  })
  it('says who may enter a trial in words', () => {
    expect(['members', 'invitational', 'public'].map(participationLabel)).toEqual(['GROUP MEMBERS', 'INVITED ONLY', 'ANYONE'])
  })
})
