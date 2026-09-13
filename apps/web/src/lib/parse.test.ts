import { describe, it, expect } from 'vitest'
import { parseTrace } from './parse'

const enc = (s: string) => new TextEncoder().encode(s).buffer

describe('parseTrace dispatch', () => {
  it('rejects KML with a dedicated no-timing reason (KML has no timestamps)', async () => {
    const kml = '<kml><Placemark><LineString><coordinates>-0.9,51.4 -0.91,51.5</coordinates></LineString></Placemark></kml>'
    const r = await parseTrace('activity.kml', enc(kml))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('kml_no_timing')
  })

  it('reports unknown_format for an unsupported extension', async () => {
    const r = await parseTrace('notes.txt', enc('hello'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_format')
  })

  it('parses a TCX through the dispatcher', async () => {
    const tcx = `<TrainingCenterDatabase><Trackpoint><Time>2026-05-23T08:37:14Z</Time><Position><LatitudeDegrees>51.46</LatitudeDegrees><LongitudeDegrees>-0.97</LongitudeDegrees></Position></Trackpoint></TrainingCenterDatabase>`
    const r = await parseTrace('activity.tcx', enc(tcx))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.track).toHaveLength(1)
  })
})
