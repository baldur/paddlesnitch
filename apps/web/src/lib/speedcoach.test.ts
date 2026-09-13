import { describe, it, expect } from 'vitest'
import { looksLikeSpeedCoach, parseSpeedCoachCsv } from './speedcoach'

// Minimal SpeedCoach-shaped CSV: session preamble with a Start Time, then the
// Per-Stroke Data section (header found by column name, units row, data rows).
const SC = [
  'Session Information:,,,',
  'Start Time:,11/15/2025 13:42:54,,',
  'Per-Stroke Data:',
  'Interval,Elapsed Time,Stroke Rate,GPS Lat.,GPS Lon.',
  '(Interval),(HH:MM:SS.tenths),(SPM),(Degrees),(Degrees)',
  '1,00:00:03.0,20,51.4760,-0.2734',
  '1,00:00:13.0,30,51.4759,-0.2733',
  '1,00:00:23.0,32,---,---',            // no GPS fix — skipped
].join('\n')

describe('parseSpeedCoachCsv', () => {
  it('detects a SpeedCoach export', () => {
    expect(looksLikeSpeedCoach(SC)).toBe(true)
    expect(looksLikeSpeedCoach('lat,lon,time\n1,2,3')).toBe(false)
  })

  it('parses GPS rows with absolute time = start + elapsed, and stroke rate', () => {
    const t = parseSpeedCoachCsv(SC)
    expect(t).toHaveLength(2) // the "---" row is dropped
    // 13:42:54 UTC + 3.0s
    expect(t[0].timestamp.toISOString()).toBe('2025-11-15T13:42:57.000Z')
    expect(t[0].strokeRate).toBe(20)
    expect(t[0].lat).toBeCloseTo(51.4760)
    // +13.0s
    expect(t[1].timestamp.toISOString()).toBe('2025-11-15T13:43:07.000Z')
    expect(t[1].strokeRate).toBe(30)
  })

  it('skips the units row (its elapsed cell is not a clock value)', () => {
    // If the units row leaked through we'd get 3 points, not 2.
    expect(parseSpeedCoachCsv(SC)).toHaveLength(2)
  })

  it('returns empty when there is no Start Time or no per-stroke section', () => {
    expect(parseSpeedCoachCsv('Per-Stroke Data:\nInterval,GPS Lat.\n1,51.4')).toHaveLength(0)
    expect(parseSpeedCoachCsv('Start Time:,11/15/2025 13:42:54')).toHaveLength(0)
  })
})
