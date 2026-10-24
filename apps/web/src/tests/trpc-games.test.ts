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

describe('live races: the mailbox', () => {
  it('two players find each other: create, join by code, offer and answer', async () => {
    const created = await as(PAT).games.live.create({ course: 'reading' })
    const { code } = created.room
    expect(code).toMatch(/^[A-HJKMNP-Z]{4}$/)
    expect(created.players.map((p) => p.name)).toEqual(['Pat R.'])

    const joined = await as(SAM).games.live.join({ code })
    expect(joined.room.course).toBe('reading')
    expect(joined.players.map((p) => p.id)).toEqual([PAT.id, SAM.id])

    // The newcomer offers to each player already there; they answer.
    await as(SAM).games.live.send({ code, to: PAT.id, kind: 'offer', sdp: 'v=0 offer' })
    const forPat = await as(PAT).games.live.inbox({ code })
    expect(forPat).toMatchObject([{ from: SAM.id, kind: 'offer', sdp: 'v=0 offer' }])
    await expect(as(PAT).games.live.inbox({ code })).resolves.toEqual([])

    await as(PAT).games.live.send({ code, to: SAM.id, kind: 'answer', sdp: 'v=0 answer' })
    expect(await as(SAM).games.live.inbox({ code })).toMatchObject([{ from: PAT.id, kind: 'answer' }])
    expect((await as(PAT).games.live.room({ code })).players).toHaveLength(2)
  })

  it('keeps out anyone who hasn\'t joined, and races that don\'t exist', async () => {
    const { room } = await as(PAT).games.live.create({ course: 'race' })
    await expect(as(SAM).games.live.inbox({ code: room.code })).rejects.toThrow(/FORBIDDEN/)
    await expect(as(SAM).games.live.send({ code: room.code, to: PAT.id, kind: 'offer', sdp: 'x' })).rejects.toThrow(/FORBIDDEN/)
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
