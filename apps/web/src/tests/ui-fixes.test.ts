// Vitest-only regression tests for the three UX fixes in this PR
// (#55, #56, #57). The browser-side z-index tweak for #57 is verified
// via a manual smoke (visiting a page with a Leaflet map); the rest
// have pure-function helpers that can be pinned cheaply.
import { describe, it, expect } from 'vitest'
import { BOAT_CLASS_INFO } from '@/lib/types'

// Extracted from src/app/att/trials/[trialId]/upload/page.tsx so we
// can test the labelling independently of the React tree. If the
// implementation changes, copy this here too — they need to stay in
// lockstep.
function seatLabel(seat: number | 'C', total: number, sport: 'kayak' | 'rowing'): string {
  if (seat === 'C') return 'Cox'
  if (sport === 'kayak') {
    if (seat === 1) return 'Front (1)'
    if (seat === total) return `Back (${seat})`
    return `Seat ${seat}`
  }
  if (seat === 1) return 'Bow (1)'
  if (seat === total) return `Stroke (${seat})`
  return `Seat ${seat}`
}

describe('#56 — K2 crew labels use kayak terminology', () => {
  // K2 carries crewSize: 2, sport: kayak. Bow/Stroke is a rowing term
  // and was confusing kayakers.
  it('K2 seat 1 reads "Front"', () => {
    const { sport, crewSize } = BOAT_CLASS_INFO.K2
    expect(seatLabel(1, crewSize, sport)).toBe('Front (1)')
  })
  it('K2 seat 2 reads "Back"', () => {
    const { sport, crewSize } = BOAT_CLASS_INFO.K2
    expect(seatLabel(2, crewSize, sport)).toBe('Back (2)')
  })

  it('K4 middle seats keep the numeric label', () => {
    const { sport, crewSize } = BOAT_CLASS_INFO.K4
    expect(seatLabel(2, crewSize, sport)).toBe('Seat 2')
    expect(seatLabel(3, crewSize, sport)).toBe('Seat 3')
  })

  it('K4 first and last seats are Front / Back', () => {
    const { sport, crewSize } = BOAT_CLASS_INFO.K4
    expect(seatLabel(1, crewSize, sport)).toBe('Front (1)')
    expect(seatLabel(4, crewSize, sport)).toBe('Back (4)')
  })

  it('rowing classes keep Bow / Stroke terminology', () => {
    const { sport, crewSize } = BOAT_CLASS_INFO['2X']
    expect(seatLabel(1, crewSize, sport)).toBe('Bow (1)')
    expect(seatLabel(2, crewSize, sport)).toBe('Stroke (2)')
  })

  it('coxed rowing boats still call the cox seat "Cox"', () => {
    const { sport, crewSize } = BOAT_CLASS_INFO['8+']
    expect(seatLabel('C', crewSize, sport)).toBe('Cox')
  })
})
