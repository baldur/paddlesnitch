// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeGpxBuffer, makeTestTrack } from './helpers'
import { putObject, getObject, listKeys } from '@/lib/storage'
import { run } from '../../scripts/strip-trial-traces'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

const DIR = 'trials/T1/entries/U1/E1/'
const gpxWithHr = () => new TextDecoder().decode(makeGpxBuffer(makeTestTrack()))
  .replace(/<\/time><\/trkpt>/g, '</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>')

describe('strip-trial-traces', () => {
  it('a dry run reports the raw file but changes nothing', async () => {
    await putObject(`${DIR}trace.gpx`, gpxWithHr())
    expect(await run(false)).toMatchObject({ checked: 1, changed: 1 })
    expect(await listKeys(DIR)).toEqual([`${DIR}trace.gpx`])
  })

  it('--apply keeps the parsed track and deletes the uploaded file', async () => {
    await putObject(`${DIR}trace.gpx`, gpxWithHr())
    await run(true)
    expect(await listKeys(DIR)).toEqual([`${DIR}trace.csv`])
    const csv = (await getObject(`${DIR}trace.csv`))!.toString()
    expect(csv).not.toMatch(/hr|150/)
    expect(csv.trim().split('\n')).toHaveLength(makeTestTrack().length + 1)
  })

  it('is idempotent, and leaves Strava snapshots alone', async () => {
    await putObject(`${DIR}trace.gpx`, gpxWithHr())
    await putObject('trials/T1/entries/U1/E2/trace.json', '{"latlng":[],"time":[],"startDate":"x"}')
    await run(true)
    expect(await run(true)).toMatchObject({ changed: 0 })
    expect(await getObject('trials/T1/entries/U1/E2/trace.json')).not.toBeNull()
  })
})
