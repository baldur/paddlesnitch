import { describe, it, expect, vi } from 'vitest'
import { parseFit } from './fit'

// fit-file-parser already returns coordinates in degrees — parseFit must not
// multiply by SEMICIRCLES_TO_DEG (≈8.38e-8). This mock locks in that contract.
vi.mock('fit-file-parser', () => ({
  default: class FitParser {
    constructor(_opts: object) {}
    parse(_buf: ArrayBuffer, cb: (err: string | null, data: unknown) => void) {
      cb(null, {
        records: [
          {
            timestamp: new Date('2024-06-01T10:00:00Z'),
            position_lat: 51.5338,
            position_long: -0.9,
            heart_rate: 142,
            cadence: 28,
            fractional_cadence: 0.5,
          },
          {
            timestamp: new Date('2024-06-01T10:01:00Z'),
            position_lat: 51.5383,
            position_long: -0.89,
            heart_rate: 145,
            cadence: 30,
          },
          {
            // no position — must be skipped
            timestamp: new Date('2024-06-01T10:02:00Z'),
            heart_rate: 150,
          },
        ],
      })
    }
  },
}))

describe('parseFit', () => {
  it('returns coordinates in degrees (regression: was multiplying by SEMICIRCLES_TO_DEG)', async () => {
    const track = await parseFit(new ArrayBuffer(0))
    expect(track[0].lat).toBeCloseTo(51.5338, 3)
    expect(track[0].lng).toBeCloseTo(-0.9, 3)
    // If the bug were reintroduced, lat would be ~4.3e-6 instead of ~51.5
  })

  it('discards heart rate but captures cadence (+fractional) as stroke rate (#143)', async () => {
    // HR stays stripped; stroke rate = cadence + fractional_cadence.
    const track = await parseFit(new ArrayBuffer(0))
    expect(track[0]).not.toHaveProperty('hr')
    expect(track[0]).not.toHaveProperty('heart_rate')
    expect(track[0].strokeRate).toBe(28.5)  // 28 + 0.5
    expect(track[1].strokeRate).toBe(30)    // no fractional part
  })

  it('parses timestamps as Date objects', async () => {
    const track = await parseFit(new ArrayBuffer(0))
    expect(track[0].timestamp).toEqual(new Date('2024-06-01T10:00:00Z'))
  })

  it('skips records with no position', async () => {
    const track = await parseFit(new ArrayBuffer(0))
    expect(track).toHaveLength(2)
  })
})
