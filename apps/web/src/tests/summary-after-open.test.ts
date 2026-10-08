// @vitest-environment node
// Adding a paddle doesn't wait for its AI summary (performance.md, phase 4):
// it's saved with the plain one and opens at once, and the paddle page asks
// for the written one. On our Lambda, after() work still holds the response,
// so the summary can't simply be moved there.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('@paddlesnitch/timing/weather', () => ({ getWeatherAt: () => Promise.resolve(null) }))
vi.mock('@paddlesnitch/timing/river-flow', () => ({ getFlowAt: () => Promise.resolve(null) }))
// The AI: counted, and able to run something while it "thinks".
const ai = vi.hoisted(() => ({ calls: 0, during: null as null | (() => Promise<void>), profile: 0 }))
vi.mock('@paddlesnitch/analysis/llm', () => ({
  generateInsight: async () => { ai.calls++; const h = ai.during; ai.during = null; await h?.(); return 'A written summary.' },
}))
vi.mock('@paddlesnitch/analysis/athlete-profile', () => ({ refreshAthleteProfile: async () => { ai.profile++ } }))

import { analyseAndSave, writePendingSummary } from '@paddlesnitch/analysis/pipeline'
import { getSession, updateSessionNote, deleteSession } from '@paddlesnitch/analysis/analysis-store'
import { createCaller } from '@paddlesnitch/api'

const USER = 'user-sum'
// Ten minutes heading north at ~3 m/s.
const track = Array.from({ length: 600 }, (_, i) => ({ lat: 51.5 + i * 0.000027, lng: -0.9, timestamp: new Date(Date.UTC(2026, 9, 8, 9, 0, i)) }))

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); ai.calls = 0; ai.profile = 0; ai.during = null })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('a paddle opens before its AI summary', () => {
  it('is saved with the plain summary and no AI call', async () => {
    const { session } = await analyseAndSave(USER, track, { type: 'file' })
    expect(ai.calls).toBe(0)
    expect(ai.profile).toBe(0)
    const saved = (await getSession(USER, session.id))!
    expect(saved.insightPending).toBe(true)
    expect(saved.insight).toBeTruthy()          // the plain one
    expect(saved.insight).not.toBe('A written summary.')
  })

  it('the page gets the written summary, and the profile is updated once', async () => {
    const { session } = await analyseAndSave(USER, track, { type: 'file' })
    const written = await createCaller({ user: { id: USER, email: 'a@x', displayName: 'A' } }).paddles.writeSummary({ id: session.id })
    expect(written.insight).toBe('A written summary.')
    expect(written.result.insight).toBe('A written summary.')
    expect(written.insightPending).toBeUndefined()
    expect((await getSession(USER, session.id))!.insightPending).toBeUndefined()
    expect(ai.profile).toBe(1)
    // Asking again doesn't call the AI again.
    await writePendingSummary(USER, session.id)
    expect(ai.calls).toBe(1)
    expect(ai.profile).toBe(1)
  })

  it('keeps a note written while the summary was being written', async () => {
    const { session } = await analyseAndSave(USER, track, { type: 'file' })
    ai.during = async () => { await updateSessionNote(USER, session.id, 'windy today') }
    const written = (await writePendingSummary(USER, session.id))!
    expect(written.note).toBe('windy today')
    expect(written.insight).toBe('A written summary.')
  })

  it('does not bring back a paddle deleted while its summary was being written', async () => {
    const { session } = await analyseAndSave(USER, track, { type: 'file' })
    ai.during = async () => { await deleteSession(USER, session.id) }
    expect(await writePendingSummary(USER, session.id)).toBeNull()
    expect(await getSession(USER, session.id)).toBeNull()
  })

  it("can't write someone else's paddle's summary", async () => {
    const { session } = await analyseAndSave(USER, track, { type: 'file' })
    await expect(createCaller({ user: { id: 'someone-else', email: 'b@x', displayName: 'B' } }).paddles.writeSummary({ id: session.id })).rejects.toThrow()
    expect(ai.calls).toBe(0)
  })

  it('a tracker paddle is saved without an AI call too: the tracker is waiting on that response', async () => {
    const { session } = await analyseAndSave(USER, track, { type: 'device', deviceId: 'ABCD1234', deviceSessionId: 's1' }, { id: 't-s1' })
    expect(ai.calls).toBe(0)
    expect(session.insightPending).toBe(true)
  })
})
