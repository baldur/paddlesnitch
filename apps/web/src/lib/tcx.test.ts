import { describe, it, expect } from 'vitest'
import { parseTcx } from './tcx'

const TCX = `<?xml version="1.0"?>
<TrainingCenterDatabase>
 <Activities><Activity Sport="Other"><Lap><Track>
  <Trackpoint>
   <Time>2026-05-23T08:37:14.000Z</Time>
   <Position><LatitudeDegrees>51.4665</LatitudeDegrees><LongitudeDegrees>-0.9791</LongitudeDegrees></Position>
   <HeartRateBpm><Value>97</Value></HeartRateBpm>
  </Trackpoint>
  <Trackpoint>
   <Time>2026-05-23T08:37:15.000Z</Time>
   <Position><LatitudeDegrees>51.4666</LatitudeDegrees><LongitudeDegrees>-0.9792</LongitudeDegrees></Position>
   <Cadence>30</Cadence>
  </Trackpoint>
  <Trackpoint>
   <Time>2026-05-23T08:37:16.000Z</Time>
   <Extensions><ns3:TPX><ns3:RunCadence>32</ns3:RunCadence></ns3:TPX></Extensions>
   <Position><LatitudeDegrees>51.4667</LatitudeDegrees><LongitudeDegrees>-0.9793</LongitudeDegrees></Position>
  </Trackpoint>
  <Trackpoint>
   <Time>2026-05-23T08:37:17.000Z</Time>
   <HeartRateBpm><Value>99</Value></HeartRateBpm>
  </Trackpoint>
 </Track></Lap></Activity></Activities>
</TrainingCenterDatabase>`

describe('parseTcx', () => {
  it('parses time + position from each Trackpoint', () => {
    const track = parseTcx(TCX)
    // The 4th point has no Position — it must be skipped.
    expect(track).toHaveLength(3)
    expect(track[0].lat).toBeCloseTo(51.4665)
    expect(track[0].lng).toBeCloseTo(-0.9791)
    expect(track[0].timestamp).toEqual(new Date('2026-05-23T08:37:14.000Z'))
  })

  it('captures stroke rate from <Cadence> and from a <RunCadence> extension (#143)', () => {
    const track = parseTcx(TCX)
    expect(track[1].strokeRate).toBe(30) // direct <Cadence>
    expect(track[2].strokeRate).toBe(32) // ns3:RunCadence extension
  })

  it('never captures heart rate, and leaves strokeRate unset when absent', () => {
    const track = parseTcx(TCX)
    expect(track[0]).not.toHaveProperty('hr')
    expect(track[0]).not.toHaveProperty('strokeRate')
  })

  it('returns empty for a TCX with no trackpoints', () => {
    expect(parseTcx('<TrainingCenterDatabase></TrainingCenterDatabase>')).toHaveLength(0)
  })
})
