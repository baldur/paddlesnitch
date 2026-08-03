import { describe, it, expect } from 'vitest'
import { resolveBoat } from './analysis-store'

describe('resolveBoat', () => {
  it('keeps a valid class + a seat that fits it', () => {
    expect(resolveBoat('8+', 3)).toEqual({ boatClass: '8+', seat: 3 })
    expect(resolveBoat('8+', 'C')).toEqual({ boatClass: '8+', seat: 'C' })  // coxed
    expect(resolveBoat('2X', 2)).toEqual({ boatClass: '2X', seat: 2 })
  })

  it('drops a seat that is out of range or a cox on a coxless boat', () => {
    expect(resolveBoat('2X', 5)).toEqual({ boatClass: '2X' })   // only seats 1–2
    expect(resolveBoat('2X', 'C')).toEqual({ boatClass: '2X' }) // no cox
    expect(resolveBoat('1X', 1)).toEqual({ boatClass: '1X', seat: 1 })
  })

  it('returns nothing for a missing or bogus class', () => {
    expect(resolveBoat(null, 2)).toEqual({})
    expect(resolveBoat('', 2)).toEqual({})
    expect(resolveBoat('rowboat', 1)).toEqual({})
  })

  it('accepts a class with no seat', () => {
    expect(resolveBoat('K2', null)).toEqual({ boatClass: 'K2' })
    expect(resolveBoat('K2', undefined)).toEqual({ boatClass: 'K2' })
  })
})
