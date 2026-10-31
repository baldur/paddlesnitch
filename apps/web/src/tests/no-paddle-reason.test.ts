// Why a tracker recording didn't become a paddle, in plain words (backlog #408).
// On 2026-10-11 a 1 h 49 min paddle got no paddle because the GPS lost the sky
// 30 s in; the page said nothing, so the paddler thought something was broken.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { noPaddleReason, noPaddleMessage } from '@paddlesnitch/timing/device'
import { storeDeviceSession, storeDeviceMotion } from '@paddlesnitch/core/devices'
import { sidecar } from './tracker-fixtures'
import { recordingReport, motionMessage } from '@/lib/recording-report'
import { makeDataDir, cleanDataDir } from './helpers'

const T0 = Date.parse('2026-10-11T07:00:00Z')
// One row a second, moving north at `mps` while `fix(s)` says the GPS has the
// sky. Without it: the old firmware's frozen last position with 0 satellites,
// or (newer firmware) an empty position.
function csv(seconds: number, opts: { mps?: number; fix?: (s: number) => boolean; lost?: 'frozen' | 'empty' } = {}) {
  const { mps = 2.5, fix = () => true, lost = 'frozen' } = opts
  const rows = ['timestamp,lat,lon,sats']
  let lastLat = 51.46
  for (let s = 0; s <= seconds; s++) {
    const t = new Date(T0 + s * 1000).toISOString()
    if (fix(s)) { lastLat = 51.46 + (s * mps) / 110_540; rows.push(`${t},${lastLat.toFixed(7)},-0.9300000,9`) }
    else rows.push(lost === 'frozen' ? `${t},${lastLat.toFixed(7)},-0.9300000,0` : `${t},,,0`)
  }
  return rows.join('\n')
}

describe('why a recording is not a paddle', () => {
  it('the GPS lost the sky 30 s in (frozen position, 0 satellites): says so, not "too short"', () => {
    const r = noPaddleReason(csv(6540, { fix: s => s <= 30 }), 500)
    expect(r).toEqual({ kind: 'gps_lost', lostAfterS: 30, recordedS: 6540 })
    expect(noPaddleMessage(r!, true)).toBe('The GPS lost the sky 30 seconds after you set off, so no route was recorded after that. The boat motion was.')
  })

  it('the same on newer firmware, which leaves the position empty', () => {
    expect(noPaddleReason(csv(3600, { fix: s => s <= 300, lost: 'empty' }), 500)).toMatchObject({ kind: 'gps_lost', lostAfterS: 300 })
    expect(noPaddleMessage({ kind: 'gps_lost', lostAfterS: 300, recordedS: 3600 }, false)).toBe('The GPS lost the sky 5 minutes after you set off, so no route was recorded after that.')
  })

  it('says "1 second", not "1 seconds", when the GPS was lost at once', () => {
    expect(noPaddleMessage({ kind: 'gps_lost', lostAfterS: 0.4, recordedS: 3600 }, false)).toBe('The GPS lost the sky 1 second after you set off, so no route was recorded after that.')
  })

  it('the GPS never found the sky', () => {
    const r = noPaddleReason(csv(900, { fix: () => false, lost: 'empty' }), 500)
    expect(r).toEqual({ kind: 'no_gps', recordedS: 900 })
    expect(noPaddleMessage(r!, true)).toBe('The GPS never found the sky, so no route was recorded. The boat motion was.')
  })

  it('a desk test: too short, with how far it moved', () => {
    const r = noPaddleReason(csv(600, { mps: 0 }), 500)
    expect(r).toEqual({ kind: 'too_short', movedM: 0, minM: 500 })
    expect(noPaddleMessage(r!, false)).toBe('Too short to be a paddle: the boat moved 0 m, and a paddle needs 500 m.')
    expect(noPaddleReason(csv(100), 500)).toMatchObject({ kind: 'too_short' })   // ~250 m
  })

  it('a short gap in the GPS is not "lost", and a real paddle has no reason', () => {
    expect(noPaddleReason(csv(3600, { fix: s => s < 1000 || s > 1100 }), 500)).toBeNull()
    expect(noPaddleReason(csv(3600), 500)).toBeNull()
    // Lost near the end, after most of the paddle was recorded: still a paddle.
    expect(noPaddleReason(csv(3600, { fix: s => s < 3000 }), 500)).toBeNull()
  })

  it('an empty or unreadable file gives no reason rather than a wrong one', () => {
    expect(noPaddleReason('', 500)).toBeNull()
    expect(noPaddleReason('timestamp,lat,lon\nnot-a-time,1,2', 500)).toBeNull()
  })
})

describe("the recording's report carries the reason", () => {
  let dir: string
  beforeEach(async () => { dir = await makeDataDir() })
  afterEach(async () => { await cleanDataDir(dir) })

  it('a recording whose GPS was lost says so; a real paddle says nothing', async () => {
    const lost = await storeDeviceSession({ deviceId: 'AABBCCDD', userId: 'u1', filename: 'track_1.csv', points: 6541 }, csv(6540, { fix: s => s <= 30 }))
    expect((await recordingReport('u1', 'AABBCCDD', lost.sessionId))?.noPaddle).toMatch(/^The GPS lost the sky 30 seconds after you set off/)
    const ok = await storeDeviceSession({ deviceId: 'AABBCCDD', userId: 'u1', filename: 'track_2.csv', points: 3601 }, csv(3600))
    expect((await recordingReport('u1', 'AABBCCDD', ok.sessionId))?.noPaddle).toBeNull()
  })
})

describe('what the motion data says when the GPS failed (#414)', () => {
  // Paddling time and strokes are the recorder core's (recorder-core/test/stroke_rules.c).
  it('says it in plain words, rounded', () => {
    expect(motionMessage({ paddlingS: 6060, strokes: 5234, strokesPerMin: 51.6 })).toBe('From the motion data: about 1 h 41 min paddling, about 5,200 strokes at 52 spm.')
    expect(motionMessage({ paddlingS: 1500, strokes: 640, strokesPerMin: 48 })).toBe('From the motion data: about 25 min paddling, about 640 strokes at 48 spm.')
  })

  describe('on the recording', () => {
    let dir: string
    beforeEach(async () => { dir = await makeDataDir() })
    afterEach(async () => { await cleanDataDir(dir) })

    it('a recording whose GPS was lost but whose motion data shows paddling says how long and how many strokes', async () => {
      const lost = await storeDeviceSession({ deviceId: 'AABBCCDD', userId: 'u1', filename: 'track_3.csv', points: 1201 }, csv(1200, { fix: s => s <= 30 }))
      expect(await storeDeviceMotion('AABBCCDD', 'u1', 'track_3.csv', sidecar({ seconds: 600, hz: 10, strokesPerMin: 50 }), 6000)).not.toBe('no_track')
      const r = await recordingReport('u1', 'AABBCCDD', lost.sessionId)
      expect(r?.noPaddle).toMatch(/^The GPS lost the sky 30 seconds after you set off/)
      expect(r?.fromMotion).toMatch(/^From the motion data: about 10 min paddling, about \d+ strokes at (49|50|51) spm\.$/)
    })

    it('a desk test (too short) gets no motion line', async () => {
      const desk = await storeDeviceSession({ deviceId: 'AABBCCDD', userId: 'u1', filename: 'track_4.csv', points: 601 }, csv(600, { mps: 0 }))
      await storeDeviceMotion('AABBCCDD', 'u1', 'track_4.csv', sidecar({ seconds: 600, hz: 10, strokesPerMin: 50 }), 6000)
      expect((await recordingReport('u1', 'AABBCCDD', desk.sessionId))?.fromMotion).toBeNull()
    })
  })
})
