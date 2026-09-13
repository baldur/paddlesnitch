import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { putJson, putObject } from '@paddlesnitch/core/storage'
import { listUserTrialEntries, loadTrialEntryTrack } from '@paddlesnitch/analysis/trials'

// Time-trial entries live in the SHARED att storage layout; these tests write
// that layout to a temp dir and read it back through the analysis bridge (#159).
let dir: string
const USER = 'user-abc'
const OTHER = 'user-xyz'

const GPX = `<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="51.5000" lon="-0.9000"><time>2026-05-01T10:00:00Z</time></trkpt>
<trkpt lat="51.5010" lon="-0.9000"><time>2026-05-01T10:00:30Z</time></trkpt>
<trkpt lat="51.5020" lon="-0.9000"><time>2026-05-01T10:01:00Z</time></trkpt>
</trkseg></trk></gpx>`

async function writeEntry(trialId: string, userId: string, entryId: string, opts: {
  courseId: string; courseName: string; trialName: string; raceDate: string; trace: { name: string; body: string | Buffer }
}) {
  await putJson(`trials/${trialId}/metadata.json`, { id: trialId, name: opts.trialName, courseId: opts.courseId, date: opts.raceDate })
  await putJson(`courses/${opts.courseId}/metadata.json`, { id: opts.courseId, name: opts.courseName, distanceMetres: 1000 })
  await putJson(`trials/${trialId}/entries/${userId}/${entryId}/result.json`, {
    entryId, userId, filename: opts.trace.name, raceDate: opts.raceDate,
    result: { startTimestamp: `${opts.raceDate}T10:00:00Z`, totalElapsedSeconds: 240 },
  })
  await putObject(`trials/${trialId}/entries/${userId}/${entryId}/trace.${opts.trace.name.split('.').pop()}`, opts.trace.body)
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'att-trials-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('listUserTrialEntries', () => {
  it('lists only the given user\'s entries, newest first, with course + trial names', async () => {
    await writeEntry('t1', USER, 'e1', { courseId: 'c1', courseName: 'Elliðaár 1000m', trialName: 'Spring Sprint', raceDate: '2026-05-01', trace: { name: 'a.gpx', body: GPX } })
    await writeEntry('t2', USER, 'e2', { courseId: 'c2', courseName: 'Harbour 500m', trialName: 'Summer Champs', raceDate: '2026-06-10', trace: { name: 'b.gpx', body: GPX } })
    await writeEntry('t1', OTHER, 'e9', { courseId: 'c1', courseName: 'Elliðaár 1000m', trialName: 'Spring Sprint', raceDate: '2026-05-01', trace: { name: 'z.gpx', body: GPX } })

    const list = await listUserTrialEntries(USER)
    expect(list.map(e => e.entryId)).toEqual(['e2', 'e1'])   // newest paddle first
    expect(list.find(e => e.entryId === 'e2')?.courseName).toBe('Harbour 500m')
    expect(list.find(e => e.entryId === 'e2')?.trialName).toBe('Summer Champs')
    expect(list.find(e => e.entryId === 'e1')?.distanceMetres).toBe(1000)
    // never another user's entry
    expect(list.some(e => e.entryId === 'e9')).toBe(false)
  })

  it('returns [] for a user with no entries', async () => {
    expect(await listUserTrialEntries('nobody')).toEqual([])
  })
})

describe('loadTrialEntryTrack', () => {
  it('parses a raw GPX trace into track points', async () => {
    await writeEntry('t1', USER, 'e1', { courseId: 'c1', courseName: 'C', trialName: 'T', raceDate: '2026-05-01', trace: { name: 'a.gpx', body: GPX } })
    const track = await loadTrialEntryTrack(USER, 't1', 'e1')
    expect(track).not.toBeNull()
    expect(track!.length).toBe(3)
    expect(track![0].lat).toBeCloseTo(51.5, 3)
  })

  it('reconstructs a track from a Strava-import snapshot (trace.json)', async () => {
    await putObject('trials/t3/entries/' + USER + '/e3/trace.json', JSON.stringify({
      source: 'strava', activityId: 42, startDate: '2026-05-01T10:00:00Z',
      latlng: [[51.5, -0.9], [51.501, -0.9], [51.502, -0.9]], time: [0, 30, 60],
    }))
    const track = await loadTrialEntryTrack(USER, 't3', 'e3')
    expect(track).not.toBeNull()
    expect(track!.length).toBe(3)
    expect(track![2].timestamp.toISOString()).toBe('2026-05-01T10:01:00.000Z')
  })

  it('returns null for another user\'s entry (userId is in the key)', async () => {
    await writeEntry('t1', OTHER, 'e9', { courseId: 'c1', courseName: 'C', trialName: 'T', raceDate: '2026-05-01', trace: { name: 'z.gpx', body: GPX } })
    expect(await loadTrialEntryTrack(USER, 't1', 'e9')).toBeNull()
  })

  it('rejects path-traversal ids', async () => {
    expect(await loadTrialEntryTrack(USER, '../secrets', 'e1')).toBeNull()
  })
})
