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

  describe('row capture', () => {
    it('reports a complete trace as fully captured, with no gaps', () => {
      const r = describeDeviceData(movingRows(120))
      expect(r.capture.intervalS).toBe(1)
      expect(r.capture.gaps).toBe(0)
      expect(r.capture.missingRows).toBe(0)
      expect(r.capture.capturedFraction).toBe(1)
    })

    it('counts dropped rows instead of hiding them behind the duration', () => {
      // Same session, but seconds 30 and 74 never made it to the card — the shape
      // of the real loss, where periodic SD work steals a single row.
      const lines = movingRows(120).split('\n')
      const holed = lines.filter((_, i) => i !== 31 && i !== 75).join('\n')
      const r = describeDeviceData(holed)
      expect(r.capture.gaps).toBe(2)
      expect(r.capture.missingRows).toBe(2)
      expect(r.capture.longestGapS).toBe(2)
      expect(r.capture.expectedRows).toBe(120)
      expect(r.capture.capturedFraction).toBeLessThan(1)
      expect(r.capture.capturedFraction).toBeGreaterThan(0.95)
    })

    it('derives the sampling interval from the file, not a hardcoded 1 Hz', () => {
      // A 2-second-interval trace is complete, not half-missing.
      const t0 = Date.parse('2026-09-05T09:00:00Z')
      const rows = Array.from({ length: 60 }, (_, i) =>
        `${new Date(t0 + i * 2000).toISOString()},${i * 2000},1,${(51.46 + i * 0.00006).toFixed(6)},-0.930000,10,12.0,0,12,0.9,4050,${i},1.1,0.1,0.2,10,10,11,1.4,12,30,49`)
      const r = describeDeviceData([HEADER, ...rows].join('\n'))
      expect(r.capture.intervalS).toBe(2)
      expect(r.capture.gaps).toBe(0)
      expect(r.capture.capturedFraction).toBe(1)
    })
  })

  describe('GNSS quality', () => {
    it('reports a converging fix as improving, and surfaces altitude wander', () => {
      // Cold start: 8 sats / hdop 1.5 settling to 14 sats / hdop 0.8, with the
      // altitude noise a GPS reports on flat water.
      const t0 = Date.parse('2026-09-05T09:00:00Z')
      const rows = Array.from({ length: 120 }, (_, i) => {
        const sats = 8 + Math.min(6, Math.floor(i / 17))
        const hdop = (1.5 - Math.min(0.7, i * 0.007)).toFixed(1)
        const alt = 30 + (i % 20) // wanders 19 m without going anywhere
        return `${new Date(t0 + i * 1000).toISOString()},${i * 1000},1,${(51.46 + i * 0.00003).toFixed(6)},-0.930000,${alt},12.0,0,${sats},${hdop},4050,${i},1.1,0.1,0.2,10,10,11,1.4,12,30,49`
      })
      const r = describeDeviceData([HEADER, ...rows].join('\n'))
      expect(r.gnss.satsFirst).toBe(8)
      expect(r.gnss.satsMax).toBe(14)
      expect(r.gnss.hdopFirst).toBe(1.5)
      expect(r.gnss.fixTrend).toBe('improving')
      expect(r.gnss.altitudeSpreadM).toBe(19)
    })

    it('leaves GNSS fields null when the file has no sats/hdop columns', () => {
      const r = describeDeviceData('timestamp,lat,lon\n2026-09-05T09:00:00Z,51.46,-0.93')
      expect(r.gnss.satsFirst).toBeNull()
      expect(r.gnss.hdopMedian).toBeNull()
      expect(r.gnss.fixTrend).toBeNull()
      expect(r.motion).toBeNull()
    })
  })

  describe('motion envelope', () => {
    it('separates the paddling ceiling from off-water handling spikes', () => {
      // The real signature: a quiet paddle bookended by the device being picked
      // up and put down while stationary.
      const t0 = Date.parse('2026-09-05T09:00:00Z')
      const rows = Array.from({ length: 100 }, (_, i) => {
        const handling = i < 5 || i >= 95
        const speed = handling ? 0 : 12
        const gyro = handling ? 350 : 14 + (i % 5) // paddling tops out at 18
        const accel = handling ? 4.4 : 1.05
        return `${new Date(t0 + i * 1000).toISOString()},${i * 1000},1,${(51.46 + i * 0.00003).toFixed(6)},-0.930000,10,${speed},0,12,0.9,4050,${i},1.1,0.1,0.2,10,10,11,${accel},${gyro},30,49`
      })
      const r = describeDeviceData([HEADER, ...rows].join('\n'))
      expect(r.motion).not.toBeNull()
      expect(r.motion!.gyroPeakMaxMoving).toBe(18)
      expect(r.motion!.gyroPeakP99Moving).toBe(18)
      expect(r.motion!.gyroPeakMaxStationary).toBe(350)
      expect(r.motion!.accelPeakMaxMoving).toBe(1.05)
      expect(r.motion!.movingSamples).toBe(90)
      expect(r.motion!.stationarySamples).toBe(10)
    })

    it('does not let a landing fumble masquerade as the paddling ceiling', () => {
      // The real trap: coming in to land, the GPS still reads 3 km/h — "moving" —
      // while the device is being grabbed off the deck at 240 dps. The bare max
      // swallows that; the p99 must not, or the verdict reads as if paddling
      // produced a 240 dps signal.
      const t0 = Date.parse('2026-09-05T09:00:00Z')
      const rows = Array.from({ length: 200 }, (_, i) => {
        const landing = i >= 198 // two seconds of handling while still drifting
        const speed = landing ? 3.0 : 12
        const gyro = landing ? 240 : 14 + (i % 5)
        return `${new Date(t0 + i * 1000).toISOString()},${i * 1000},1,${(51.46 + i * 0.00003).toFixed(6)},-0.930000,10,${speed},0,12,0.9,4050,${i},1.1,0.1,0.2,10,10,11,1.05,${gyro},30,49`
      })
      const r = describeDeviceData([HEADER, ...rows].join('\n'))
      expect(r.motion!.gyroPeakMaxMoving).toBe(240)   // the max tells the truth
      expect(r.motion!.gyroPeakP99Moving).toBe(18)    // the envelope is not fooled
      expect(r.strokeRate.evidence).toMatch(/under 18 dps/)
      expect(r.strokeRate.evidence).not.toMatch(/under 240 dps/)
    })

    it('backs the stroke-rate verdict with the numbers from this file', () => {
      const t0 = Date.parse('2026-09-05T09:00:00Z')
      const rows = Array.from({ length: 100 }, (_, i) => {
        const handling = i < 5
        return `${new Date(t0 + i * 1000).toISOString()},${i * 1000},1,${(51.46 + i * 0.00003).toFixed(6)},-0.930000,10,${handling ? 0 : 12},0,12,0.9,4050,${i},1.1,0.1,0.2,10,10,11,1.05,${handling ? 350 : 18},30,49`
      })
      const r = describeDeviceData([HEADER, ...rows].join('\n'))
      expect(r.strokeRate.available).toBe(false)
      expect(r.strokeRate.evidence).toMatch(/18 dps/)
      expect(r.strokeRate.evidence).toMatch(/350 dps/)
    })

    it('carries no evidence line when the firmware supplies real cadence', () => {
      const r = describeDeviceData(movingRows(90, true))
      expect(r.strokeRate.available).toBe(true)
      expect(r.strokeRate.evidence).toBeNull()
    })
  })

  describe('dead columns', () => {
    it('flags a column the firmware writes but never fills (batt_mv logging 0)', () => {
      // movingRows writes batt_mv 4050; zero it to reproduce the real trace.
      const zeroed = movingRows(90).split('\n')
        .map((l, i) => (i === 0 ? l : l.split(',').map((c, j) => (j === 10 ? '0' : c)).join(',')))
        .join('\n')
      const r = describeDeviceData(zeroed)
      expect(r.deadColumns).toContainEqual({ name: 'batt_mv', kind: 'zero' })
    })

    it('does NOT flag a constant non-zero column — fix=1 all session is good news', () => {
      const r = describeDeviceData(movingRows(90))
      expect(r.deadColumns.map(c => c.name)).not.toContain('fix')
      expect(r.deadColumns.map(c => c.name)).not.toContain('batt_mv')
    })

    it('flags the empty columns of a no-fix bench log', () => {
      const r = describeDeviceData(benchRows(120))
      const names = r.deadColumns.map(c => c.name)
      expect(names).toContain('lat')
      expect(names).toContain('lon')
      expect(r.deadColumns.find(c => c.name === 'lat')!.kind).toBe('empty')
    })
  })
})
