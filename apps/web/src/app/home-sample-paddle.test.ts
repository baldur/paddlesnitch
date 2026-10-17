import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { buildSamplePaddle, SAMPLE_PADDLE } from './home-sample-paddle'

// The front door shows a real paddle, frozen into JSON so the home page does
// no analysis per request. If the engine or the fixture changes, regenerate
// the JSON (write JSON.stringify(buildSamplePaddle(track)) + '\n' to
// home-sample-paddle.json) rather than editing it by hand.
describe('home page sample paddle', () => {
  it('is the real fixture run through the analysis engine, unedited', async () => {
    const buf = readFileSync(join(__dirname, '../tests/fixtures/garmin-activity-export.zip'))
    const parsed = await parseTrace('garmin-activity-export.zip', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    if (!parsed.ok) throw new Error('fixture did not parse')
    expect(buildSamplePaddle(parsed.track)).toEqual(SAMPLE_PADDLE)
  })

  it('carries a route small enough for the page and a templated summary', () => {
    expect(SAMPLE_PADDLE.route.length).toBeGreaterThan(50)
    expect(SAMPLE_PADDLE.route.length).toBeLessThanOrEqual(250)
    expect(SAMPLE_PADDLE.insight).toMatch(/paddle at about \d:\d\d\/500/)
  })
})
