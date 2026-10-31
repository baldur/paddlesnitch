// @vitest-environment node
// The kayak game's paddler kit (games/reading-thames/kit.js) against the router's kit
// schema: the game saves with a fire-and-forget call that swallows errors, so a
// style added only in the game would silently stop every save to the account.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { createCaller } from '@paddlesnitch/api'

const PAT = { id: 'user-pat', email: 'pat@example.com', displayName: 'Pat Rowe' }
const pat = createCaller({ user: PAT })

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trpc-games-kit-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe("the game's paddler kit", () => {
  it('every body, hair, hat and beard the game offers is one the account will save', async () => {
    const { BODIES, HAIRS, HATS, BEARDS, cleanKit } = await import('../../../../games/reading-thames/kit.js')
    const lists: [string, Record<string, string>][] = [['body', BODIES], ['hair', HAIRS], ['hat', HATS], ['beard', BEARDS]]
    for (const [field, list] of lists) {
      for (const value of Object.keys(list)) {
        const kit = cleanKit({ [field]: value })
        expect((kit as Record<string, unknown>)[field]).toBe(value)
        await expect(pat.games.kit.set(kit), `${field}: ${value}`).resolves.toEqual(kit)
      }
    }
    // The rowing club's scull and its colour (from the set).
    const { SCULLS, SCULL_COLOURS } = await import('../../../../games/reading-thames/scull.js')
    for (const scull of SCULLS.map((b: { id: string }) => b.id)) {
      await expect(pat.games.kit.set(cleanKit({ scull })), `scull: ${scull}`).resolves.toEqual(cleanKit({ scull }))
      expect((await pat.games.kit.get())?.scull, 'and comes back').toBe(scull)
    }
    for (const scullColour of SCULL_COLOURS) {
      await expect(pat.games.kit.set(cleanKit({ scullColour })), `colour: ${scullColour}`).resolves.toEqual(cleanKit({ scullColour }))
      expect((await pat.games.kit.get())?.scullColour).toBe(scullColour)
    }
    for (const aid of [true, false]) await expect(pat.games.kit.set(cleanKit({ aid }))).resolves.toBeTruthy()
  })

  it("a first visit's random paddler saves, and comes back the same", async () => {
    const { randomKit } = await import('../../../../games/reading-thames/kit.js')
    for (let i = 0; i < 20; i++) {
      const kit = randomKit()
      await pat.games.kit.set(kit)
      expect(await pat.games.kit.get()).toEqual(kit)
    }
  })

  it('a style the game has never heard of is turned down', async () => {
    const { cleanKit } = await import('../../../../games/reading-thames/kit.js')
    await expect(pat.games.kit.set({ ...cleanKit({}), hair: 'mohican' } as never)).rejects.toThrow()
  })
})
