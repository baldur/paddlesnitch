import { describe, it, expect } from 'vitest'
import { describeDeviceData } from '@paddlesnitch/timing/device'

// Columns per docs/features/device-data.md (firmware 0.3.0). Building rows from
// the documented schema is not guessing — it's the contract.
const HEADER = 'timestamp,ms,fix,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,batt_mv,tx_seq,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,accel_mag_max_g,gyro_mag_max_dps,imu_temp_c,imu_samples'

// A no-fix bench session: empty timestamp/lat/lon, hdop sentinel 25.5, IMU present.
function benchRows(n: number): string {
  const rows = Array.from({ length: n }, (_, i) =>
    `,${1000 + i * 1000},0,,,,,,0,25.5,0,${i},1.03,0.01,0.02,8,8,9,1.04,9,31,49`)
  return [HEADER, ...rows].join('\n')
}

// A moving session heading north ~3.3 m/row (≈12 km/h) at 1 Hz, with a fix.
function movingRows(n: number, withStrokeRate = false): string {
  const header = withStrokeRate ? `${HEADER},strokerate` : HEADER
  const t0 = Date.parse('2026-09-05T09:00:00Z')
  let lat = 51.46
  const rows = Array.from({ length: n }, (_, i) => {
    lat += 0.00003
    const t = new Date(t0 + i * 1000).toISOString() // valid, rolls over minutes
    const base = `${t},${1000 + i * 1000},1,${lat.toFixed(6)},-0.930000,10,12.0,0,12,0.9,4050,${i},1.1,0.1,0.2,10,10,11,1.4,12,30,49`
    return withStrokeRate ? `${base},84` : base
  })
  return [header, ...rows].join('\n')
}

describe('describeDeviceData', () => {
  it('reports a no-fix bench session as unusable, with no invented distance', () => {
    const r = describeDeviceData(benchRows(120))
    expect(r.rows).toBe(120)
    expect(r.fixedRows).toBe(0)
    expect(r.noFixRows).toBe(120)
    expect(r.movementDistanceM).toBe(0)
    expect(r.looksUsable).toBe(false)
    expect(r.hasImu).toBe(true)
  })

  it('is HONEST that stroke rate is not derivable from 1 Hz accelerometer data', () => {
    const r = describeDeviceData(movingRows(90))
    expect(r.strokeRate.available).toBe(false)
    expect(r.strokeRate.reason).toMatch(/per-second|1 Hz|cadence/i)
  })

  it('uses a stroke-rate column when the firmware provides one (no server change)', () => {
    const r = describeDeviceData(movingRows(90, true))
    expect(r.strokeRate.available).toBe(true)
  })

  it('movement-gates distance: real travel counts, stationary scatter does not', () => {
    const moving = describeDeviceData(movingRows(90))
    expect(moving.fixedRows).toBe(90)
    expect(moving.movementDistanceM).toBeGreaterThan(100) // ~90 × 3.3 m
    expect(moving.looksUsable).toBe(true)

    // Stationary jitter within a few metres, 1 Hz — must not accumulate.
    const jitter = [HEADER, ...Array.from({ length: 200 }, (_, i) => {
      const lat = 51.46 + (i % 2 === 0 ? 0.00001 : -0.00001) // ~1 m wobble
      const t = `2026-09-05T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`
      return `${t},${i * 1000},1,${lat.toFixed(6)},-0.930000,10,0.4,0,12,0.9,4050,${i},1.03,0,0,8,8,9,1.05,9,30,49`
    })].join('\n')
    expect(describeDeviceData(jitter).movementDistanceM).toBeLessThan(20)
  })

  it('lists every column and returns sample rows', () => {
    const r = describeDeviceData(movingRows(3))
    expect(r.columns).toContain('accel_mag_max_g')
    expect(r.columns).toContain('imu_samples')
    expect(r.sampleRows.length).toBe(3)
    expect(r.sampleRows[0].lat).toBeTruthy()
  })
})
