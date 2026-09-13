import { describe, it, expect } from 'vitest'
import { parseGpx } from './gpx'

const MINIMAL_GPX = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="51.5338" lon="-0.9000">
      <time>2024-06-01T10:00:00Z</time>
    </trkpt>
    <trkpt lat="51.5383" lon="-0.9000">
      <time>2024-06-01T10:01:00Z</time>
    </trkpt>
  </trkseg></trk>
</gpx>`

const GPX_WITH_METRICS = `<?xml version="1.0"?>
<gpx version="1.1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><trkseg>
    <trkpt lat="51.5338" lon="-0.9000">
      <time>2024-06-01T10:00:00Z</time>
      <extensions><gpxtpx:TrackPointExtension>
        <gpxtpx:hr>142</gpxtpx:hr>
        <gpxtpx:cad>28</gpxtpx:cad>
      </gpxtpx:TrackPointExtension></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>`

describe('parseGpx', () => {
  it('parses lat/lng and timestamp', () => {
    const track = parseGpx(MINIMAL_GPX)
    expect(track).toHaveLength(2)
    expect(track[0].lat).toBeCloseTo(51.5338)
    expect(track[0].lng).toBeCloseTo(-0.9)
    expect(track[0].timestamp).toEqual(new Date('2024-06-01T10:00:00Z'))
  })

  it('discards heart rate but captures cadence as stroke rate (#143)', () => {
    // HR stays stripped (sensitive biometric); cadence is captured as strokeRate.
    const track = parseGpx(GPX_WITH_METRICS)
    expect(track).toHaveLength(1)
    expect(track[0]).not.toHaveProperty('hr')
    expect(track[0].strokeRate).toBe(28)
  })

  it('captures cadence written as a bare <cadence> tag', () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="51.5" lon="-0.9"><time>2024-06-01T10:00:00Z</time><cadence>31</cadence></trkpt>
    </trkseg></trk></gpx>`
    expect(parseGpx(gpx)[0].strokeRate).toBe(31)
  })

  it('returns empty array for empty gpx', () => {
    expect(parseGpx('<gpx></gpx>')).toHaveLength(0)
  })

  it('skips points with missing or invalid time', () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="1" lon="1"></trkpt>
    </trkseg></trk></gpx>`
    expect(parseGpx(gpx)).toHaveLength(0)
  })
})
