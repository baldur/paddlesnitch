// @vitest-environment node
// Contract tests for the kayak game's API: the leaderboard, and the mailbox
// live races use to connect (docs/features/game-accounts-leaderboard-live.md).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { createCaller } from '@paddlesnitch/api'
import { plausible, raceCode, shortName, withResult } from '@paddlesnitch/core/games'

const PAT = { id: 'user-pat', email: 'pat@example.com', displayName: 'Pat Rowe' }
const SAM = { id: 'user-sam', email: 'sam@example.com', displayName: 'Sam' }
const as = (user: typeof PAT | null) => createCaller({ user })

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trpc-games-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('your paddler and boat', () => {
  const KIT = { skin: '#c48a60', head: 'hair', headColour: '#3b2414', sleeves: 'long', top: '#2563eb', glasses: 'aviator', glassesColour: '#f97316', boat: 'kirton-typhoon', deck: '#dc2626', hullColour: '#f2ede0', stripe: '#f5f5f4', deckShape: 'wings', hullShape: 'vee', paddle: 'flat', shaftColour: '#18181b', bladeColour: '#2563eb' } as const

  it('is saved on the account and read back, for that player only', async () => {
    expect(await as(PAT).games.kit.get()).toBeNull()
    await as(PAT).games.kit.set(KIT)
    expect(await as(PAT).games.kit.get()).toEqual(KIT)
    expect(await as(SAM).games.kit.get()).toBeNull()
    await expect(as(null).games.kit.get()).rejects.toThrow(/UNAUTHORIZED/)
  })

  it('takes only colours and the known boats and choices', async () => {
    await expect(as(PAT).games.kit.set({ ...KIT, top: 'red' })).rejects.toThrow()
    await expect(as(PAT).games.kit.set({ ...KIT, boat: 'canoe' as never })).rejects.toThrow()
    await expect(as(PAT).games.kit.set({ ...KIT, extra: 1 } as never)).rejects.toThrow()
  })

  it('takes the paddler kit without the old head (body, hair, hat, beard, buoyancy aid), and an old kit still', async () => {
    const { head: _h, headColour: _c, ...rest } = KIT
    const NEW = {
      ...rest, body: 'curvy', hair: 'ponytail', hairColour: '#3b2414', hat: 'visor', hatColour: '#f5f5f4',
      beard: 'none', aid: true, aidColour: '#dc2626',
    } as const
    await as(PAT).games.kit.set(NEW)
    expect(await as(PAT).games.kit.get()).toEqual(NEW)
    await as(SAM).games.kit.set(KIT) // a page cached from before the deploy
    expect(await as(SAM).games.kit.get()).toEqual(KIT)
    const mixed = { ...NEW, head: 'cap', headColour: '#18181b' } as const // old and new together
    await as(PAT).games.kit.set(mixed)
    expect(await as(PAT).games.kit.get()).toEqual(mixed)
    for (const bad of [
      { body: 'other' }, { hair: 'mohawk' }, { hat: 'helmet' }, { beard: 'goatee' }, { aid: 'yes' },
      { hairColour: 'red' }, { hatColour: 'red' }, { aidColour: 'red' }, { head: 'helmet' }, { headColour: 'red' },
    ]) {
      await expect(as(PAT).games.kit.set({ ...NEW, ...bad } as never)).rejects.toThrow()
    }
  })

  it("knows the same boats as the game", async () => {
    const { BOATS } = await import('../../../../games/kayak/boats.js')
    const { GAME_BOATS } = await import('@paddlesnitch/core/games')
    expect(BOATS.map((b: { id: string }) => b.id)).toEqual([...GAME_BOATS])
  })

  it('a time is posted with the boat it was paddled in', async () => {
    await as(PAT).games.submit({ course: 'race', time: 1900, hull: 'kirton-pulsar' })
    expect((await as(PAT).games.leaderboard({ course: 'race' })).top[0].hull).toBe('kirton-pulsar')
  })
})

describe('the leaderboard', () => {
  it('keeps each player\'s best only, fastest first, and shows names as first name and initial', async () => {
    await as(PAT).games.submit({ course: 'race', time: 1900, hull: 'club' })
    await as(SAM).games.submit({ course: 'race', time: 1800, hull: 'racing' })
    const slower = await as(PAT).games.submit({ course: 'race', time: 1950, hull: 'club' })
    expect(slower).toEqual({ best: false, rank: 2 })
    const faster = await as(PAT).games.submit({ course: 'race', time: 1750.04, hull: 'stable' })
    expect(faster).toEqual({ best: true, rank: 1 })

    const board = await as(SAM).games.leaderboard({ course: 'race' })
    expect(board.top.map((e) => [e.rank, e.name, e.time, e.hull, e.you])).toEqual([[1, 'Pat R.', 1750, 'stable', false], [2, 'Sam', 1800, 'racing', true]])
    expect(board.you).toMatchObject({ rank: 2, time: 1800 })
    expect(JSON.stringify(board)).not.toContain('user-')
  })

  it('anyone can look, only a signed-in player can post, and only a possible time', async () => {
    await expect(as(null).games.leaderboard({ course: 'loop' })).resolves.toEqual({ top: [], you: null })
    await expect(as(null).games.submit({ course: 'loop', time: 1700, hull: 'club' })).rejects.toThrow(/UNAUTHORIZED/)
    await expect(as(PAT).games.submit({ course: 'loop', time: 600, hull: 'club' })).rejects.toThrow(/implausible_time/)
  })

  it('a course\'s distance at 18 km/h is the fastest possible', () => {
    expect(plausible('race', 1200)).toBe(true)
    expect(plausible('race', 1199)).toBe(false)
    expect(plausible('practice', Number.NaN)).toBe(false)
  })

  it("takes results on the Reading Hasler courses, at their own distances, and keeps the old courses", async () => {
    expect(plausible('hasler79', 1580)).toBe(true) // 7900 m at 18 km/h
    expect(plausible('hasler79', 1579)).toBe(false)
    expect(plausible('hasler16', 2520)).toBe(true) // 12600 m
    expect(plausible('hasler16', 2519)).toBe(false)
    expect((await as(PAT).games.submit({ course: 'hasler79', time: 2400, hull: 'club' })).best).toBe(true)
    expect((await as(SAM).games.leaderboard({ course: 'hasler16' })).top).toEqual([])
    const { room } = await as(PAT).games.live.create({ course: 'hasler16' })
    expect(room.course).toBe('hasler16')
    // A board stored before the Hasler courses still reads back, under its old key.
    for (const course of ['race', 'practice', 'reading', 'loop'] as const) {
      const file = path.join(dir, 'games/kayak/leaderboard', `${course}.json`)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify([{ userId: 'user-old', name: 'Old T.', time: 3000, hull: 'club', at: '2026-10-01T00:00:00Z' }]))
      const { top } = await as(null).games.leaderboard({ course })
      expect(top.map(e => e.name)).toEqual(['Old T.'])
    }
  })

  it('keeps the top 100', () => {
    let board = Array.from({ length: 100 }, (_, i) => ({ userId: `u${i}`, name: 'x', time: 1000 + i, hull: 'club', at: '' }))
    board = withResult(board, { userId: 'new', name: 'y', time: 999, hull: 'club', at: '' }).board
    expect(board).toHaveLength(100)
    expect(board[0].userId).toBe('new')
    expect(board.at(-1)!.userId).toBe('u98')
  })

  it('shortens names', () => {
    expect(shortName('Baldur Gudbjornsson')).toBe('Baldur G.')
    expect(shortName('  ')).toBe('A paddler')
    expect(shortName('Cher')).toBe('Cher')
  })
})

describe('live races: making, joining and the relay ticket', () => {
  it('two players get into the same race, each with a one-use ticket for the relay', async () => {
    const created = await as(PAT).games.live.create({ course: 'reading' })
    const { code } = created.room
    expect(code).toMatch(/^[A-HJKMNP-Z]{4}$/)
    expect(created.players.map((p) => p.name)).toEqual(['Pat R.'])

    const joined = await as(SAM).games.live.join({ code })
    expect(joined.room.course).toBe('reading')
    expect(joined.players.map((p) => p.id)).toEqual([PAT.id, SAM.id])

    // The relay reads the ticket from the store to know who is connecting.
    for (const [who, { relay }] of [[PAT, created], [SAM, joined]] as const) {
      expect(relay.url).toBeNull() // unset locally: the game uses its own origin's /live
      const pass = JSON.parse(await fs.readFile(path.join(dir, `games/live/tickets/${relay.ticket}.json`), 'utf8'))
      expect(pass).toMatchObject({ code, userId: who.id })
      expect(pass.expires).toBeGreaterThan(Date.now())
    }
    expect(created.relay.ticket).not.toBe(joined.relay.ticket)
  })

  it('a new ticket to reconnect, only for a player in the race', async () => {
    const { room } = await as(PAT).games.live.create({ course: 'race' })
    await expect(as(PAT).games.live.ticket({ code: room.code })).resolves.toMatchObject({ ticket: expect.stringMatching(/^[\w-]{20,}$/) })
    await expect(as(SAM).games.live.ticket({ code: room.code })).rejects.toThrow(/FORBIDDEN/)
    await expect(as(PAT).games.live.ticket({ code: 'ZZZZ' })).rejects.toThrow(/race_gone/)
    await expect(as(SAM).games.live.join({ code: 'ZZZZ' })).rejects.toThrow(/race_gone_or_full/)
    await expect(as(null).games.live.create({ course: 'race' })).rejects.toThrow(/UNAUTHORIZED/)
  })

  it('a race holds six', async () => {
    const { room } = await as(PAT).games.live.create({ course: 'race' })
    for (let i = 0; i < 5; i++) await as({ id: `p${i}`, email: '', displayName: `P ${i}` }).games.live.join({ code: room.code })
    await expect(as(SAM).games.live.join({ code: room.code })).rejects.toThrow(/race_gone_or_full/)
    await expect(as(PAT).games.live.join({ code: room.code })).resolves.toBeTruthy() // rejoining after a reload
  })

  it('race codes are four letters with no look-alikes', () => {
    expect(raceCode(Buffer.from([0, 8, 11, 22]))).toBe('AJNZ')
  })
})
