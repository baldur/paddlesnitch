import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses standard lat/lon/time columns', () => {
    const csv = `lat,lon,time\n51.5338,-0.9,2024-06-01T10:00:00Z\n51.5383,-0.89,2024-06-01T10:01:00Z`
    const track = parseCsv(csv)
    expect(track).toHaveLength(2)
    expect(track[0].lat).toBeCloseTo(51.5338)
    expect(track[0].lng).toBeCloseTo(-0.9)
    expect(track[0].timestamp).toEqual(new Date('2024-06-01T10:00:00Z'))
  })

  it('accepts latitude/longitude as column names', () => {
    const csv = `latitude,longitude,timestamp\n51.5,-0.9,2024-06-01T10:00:00Z`
    expect(parseCsv(csv)).toHaveLength(1)
  })

  it('captures stroke rate under any of its column aliases (#143)', () => {
    for (const col of ['cadence', 'Stroke Rate', 'SPM', 'sr']) {
      const csv = `lat,lon,time,${col}\n51.5,-0.9,2024-06-01T10:00:00Z,30`
      expect(parseCsv(csv)[0].strokeRate).toBe(30)
    }
  })

  it('ignores heart rate and leaves strokeRate unset when absent', () => {
    const csv = `lat,lon,time,hr\n51.5,-0.9,2024-06-01T10:00:00Z,150`
    const p = parseCsv(csv)[0]
    expect(p).not.toHaveProperty('hr')
    expect(p).not.toHaveProperty('strokeRate')
  })

  it('parses unix second timestamps', () => {
    const ts = Math.floor(new Date('2024-06-01T10:00:00Z').getTime() / 1000)
    const csv = `lat,lon,time\n51.5,-0.9,${ts}`
    const track = parseCsv(csv)
    expect(track[0].timestamp).toEqual(new Date('2024-06-01T10:00:00Z'))
  })

  it('parses unix millisecond timestamps', () => {
    const ts = new Date('2024-06-01T10:00:00Z').getTime()
    const csv = `lat,lon,time\n51.5,-0.9,${ts}`
    const track = parseCsv(csv)
    expect(track[0].timestamp).toEqual(new Date('2024-06-01T10:00:00Z'))
  })

  it('parses YYYY-MM-DD HH:MM:SS timestamps', () => {
    const csv = `lat,lon,time\n51.5,-0.9,2024-06-01 10:00:00`
    const track = parseCsv(csv)
    expect(track[0].timestamp).toEqual(new Date('2024-06-01T10:00:00'))
  })

  it('discards heart rate and cadence even when columns are present', () => {
    // Privacy: HR/cadence are stripped at parse time, never enter the data model.
    const csv = `lat,lon,time,hr,cadence\n51.5,-0.9,2024-06-01T10:00:00Z,142,28`
    const track = parseCsv(csv)
    expect(track[0]).not.toHaveProperty('hr')
    expect(track[0]).not.toHaveProperty('cadence')
  })

  it('returns empty array when required columns are missing', () => {
    expect(parseCsv(`lat,time\n51.5,2024-06-01T10:00:00Z`)).toHaveLength(0)
    expect(parseCsv(`lon,time\n-0.9,2024-06-01T10:00:00Z`)).toHaveLength(0)
    expect(parseCsv(`lat,lon\n51.5,-0.9`)).toHaveLength(0)
  })

  it('skips rows with invalid coordinates', () => {
    const csv = `lat,lon,time\n91,-0.9,2024-06-01T10:00:00Z\n51.5,-0.9,2024-06-01T10:01:00Z`
    expect(parseCsv(csv)).toHaveLength(1)
  })

  it('returns empty array for fewer than 2 lines', () => {
    expect(parseCsv('')).toHaveLength(0)
    expect(parseCsv('lat,lon,time')).toHaveLength(0)
  })
})
