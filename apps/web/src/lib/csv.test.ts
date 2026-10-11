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

// From a real recording (tracker 435AC17C, 2026-10-11): the header, a good row,
// two rows cut short mid-write, and rows the GPS had already lost (0 sats)
// that still carried the last position with fix=1.
describe('parseCsv on a damaged tracker recording', () => {
  const HEAD = 'timestamp,ms,utc_date,utc_time,fix,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,batt_mv,tx_seq,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,accel_mag_max_g,gyro_mag_max_dps,imu_temp_c,imu_samples'
  const GOOD = '2026-10-11T07:29:01Z,70134,2026-10-11,07:29:01,1,51.4677922,-0.9819680,45.6,0.00,188.6,7,1.2,4123,0,-0.1279,-0.0129,1.0032,1.78,-5.70,-0.58,1.0415,9.30,16.6,26'
  const CUT_1 = '2026-10-11T07:54:55Z,1623634,2026-10-11,07:54:55,1,51.4679505,-0.9827562,35.9,15.72,276.6,1.46,-1.75,4.60,1.0456,38.43,16.6,44'
  const CUT_2 = '2026-10-11T07:55:16Z,1644641,2026-10-11,07:55:16,1,27,1.0612,42.12,16.7,44'
  const STALE = '2026-10-11T09:18:50Z,6658719,2026-10-11,09:18:50,1,51.4679505,-0.9827562,35.9,15.72,276.6,0,21.9,4063,0,-0.1489,-0.0134,1.0127,0.32,-1.22,-0.83,1.0714,26.01,17.8,44'

  it('skips a row cut short, instead of reading moved fields as a position (lat 27 put it in the Sahara)', () => {
    const pts = parseCsv([HEAD, GOOD, CUT_1, CUT_2].join('\n'))
    expect(pts).toHaveLength(1)
    expect(pts[0].lat).toBeCloseTo(51.4678, 4)
  })

  it('skips rows reporting 0 satellites, though they say fix=1 and carry the last position', () => {
    expect(parseCsv([HEAD, GOOD, STALE].join('\n'))).toHaveLength(1)
  })

  it('a file with no satellites column is read as before', () => {
    expect(parseCsv('lat,lon,time\n51.5,-0.9,2026-10-11T07:00:00Z')).toHaveLength(1)
  })
})

