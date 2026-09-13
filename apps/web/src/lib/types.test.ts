import { describe, it, expect } from 'vitest'
import { expectedSeats, validateCrew } from './types'

describe('expectedSeats', () => {
  it('K1 has one seat (no cox)', () => {
    expect(expectedSeats('K1')).toEqual([1])
  })

  it('K2 has two seats (no cox)', () => {
    expect(expectedSeats('K2')).toEqual([1, 2])
  })

  it('1X has one seat (no cox)', () => {
    expect(expectedSeats('1X')).toEqual([1])
  })

  it('4- has four seats (no cox)', () => {
    expect(expectedSeats('4-')).toEqual([1, 2, 3, 4])
  })

  it('4+ has four seats plus a cox', () => {
    expect(expectedSeats('4+')).toEqual([1, 2, 3, 4, 'C'])
  })

  it('8+ has eight seats plus a cox', () => {
    expect(expectedSeats('8+')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 'C'])
  })

  it('4X+ has four seats plus a cox (sculling)', () => {
    expect(expectedSeats('4X+')).toEqual([1, 2, 3, 4, 'C'])
  })
})

describe('validateCrew', () => {
  it('accepts a complete K1 crew', () => {
    expect(validateCrew('K1', [{ name: 'Alice', seat: 1 }])).toBeNull()
  })

  it('accepts a complete 4+ crew with cox', () => {
    expect(validateCrew('4+', [
      { name: 'A', seat: 1 },
      { name: 'B', seat: 2 },
      { name: 'C', seat: 3 },
      { name: 'D', seat: 4 },
      { name: 'Cox', seat: 'C' },
    ])).toBeNull()
  })

  it('rejects crew with wrong size', () => {
    const result = validateCrew('K2', [{ name: 'Alone', seat: 1 }])
    expect(result).toContain('needs 2')
  })

  it('rejects crew with empty name', () => {
    expect(validateCrew('K2', [
      { name: 'Alice', seat: 1 },
      { name: '', seat: 2 },
    ])).toBe('All crew members need a name')
  })

  it('rejects crew with whitespace-only name', () => {
    expect(validateCrew('K2', [
      { name: 'Alice', seat: 1 },
      { name: '   ', seat: 2 },
    ])).toBe('All crew members need a name')
  })

  it('rejects duplicate seats', () => {
    const result = validateCrew('K2', [
      { name: 'A', seat: 1 },
      { name: 'B', seat: 1 },
    ])
    expect(result).toContain('listed more than once')
  })

  it('rejects an invalid seat number', () => {
    const result = validateCrew('K2', [
      { name: 'A', seat: 1 },
      { name: 'B', seat: 5 },
    ])
    expect(result).toContain('not valid')
  })

  it('rejects a cox seat on a boat without cox', () => {
    const result = validateCrew('4-', [
      { name: 'A', seat: 1 },
      { name: 'B', seat: 2 },
      { name: 'C', seat: 3 },
      { name: 'Cox', seat: 'C' },
    ])
    expect(result).toContain('not valid')
  })

  it('requires a cox on a 4+', () => {
    const result = validateCrew('4+', [
      { name: 'A', seat: 1 },
      { name: 'B', seat: 2 },
      { name: 'C', seat: 3 },
      { name: 'D', seat: 4 },
    ])
    expect(result).toContain('needs 5')
  })
})
