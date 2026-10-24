// The kayak game's server side: a leaderboard per course, and the mailbox that
// lets browsers find each other for a live race (docs/features/game-accounts-leaderboard-live.md).
//
// Live races connect browser to browser (WebRTC). This only carries the
// handshake: a few small messages per pair of players, kept in the object store
// one object each (the store has no atomic append, so nothing is ever
// read-modified-written by two players at once).
import { randomBytes } from 'crypto'
import { getJson, putJson, listKeys, deleteObject } from './storage'

// --- leaderboard -------------------------------------------------------------

/** The game's courses, and their distances as the game shows them (metres). */
export const GAME_COURSES = { race: 6000, practice: 1000, reading: 6260, loop: 5400 } as const
export type GameCourse = keyof typeof GAME_COURSES
export const GAME_HULLS = ['stable', 'club', 'racing'] as const

/** Faster than this over a course's shown distance isn't paddling (an elite K1 sprints at about 18 km/h). */
export const MAX_KMH = 18
export const KEEP = 100
const SHOWN = 20

export type BoardEntry = { userId: string; name: string; time: number; hull: string; at: string }

const boardKey = (course: GameCourse) => `games/kayak/leaderboard/${course}.json`

/** "Baldur Gudbjornsson" → "Baldur G.": enough to know a clubmate, no more. */
export function shortName(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'A paddler'
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)![0].toUpperCase()}.` : parts[0]
}

/** Could a paddler really have covered the course this fast? */
export function plausible(course: GameCourse, time: number): boolean {
  return Number.isFinite(time) && time >= GAME_COURSES[course] / (MAX_KMH / 3.6) && time < 6 * 3600
}

/** A leaderboard with this result: each player's best only, fastest first, the top KEEP kept. */
export function withResult(board: BoardEntry[], entry: BoardEntry): { board: BoardEntry[]; best: boolean } {
  const mine = board.find((e) => e.userId === entry.userId)
  if (mine && mine.time <= entry.time) return { board, best: false }
  const next = [...board.filter((e) => e.userId !== entry.userId), entry].sort((a, b) => a.time - b.time).slice(0, KEEP)
  return { board: next, best: true }
}

export async function submitResult(course: GameCourse, entry: BoardEntry) {
  const { board, best } = withResult((await getJson<BoardEntry[]>(boardKey(course))) ?? [], entry)
  if (best) await putJson(boardKey(course), board)
  const rank = board.findIndex((e) => e.userId === entry.userId) + 1
  return { best, rank: rank || null }
}

export async function getLeaderboard(course: GameCourse, userId?: string) {
  const board = (await getJson<BoardEntry[]>(boardKey(course))) ?? []
  const strip = ({ name, time, hull, at }: BoardEntry) => ({ name, time, hull, at })
  const i = userId ? board.findIndex((e) => e.userId === userId) : -1
  return {
    top: board.slice(0, SHOWN).map((e, k) => ({ rank: k + 1, ...strip(e), you: e.userId === userId })),
    you: i < 0 ? null : { rank: i + 1, ...strip(board[i]) },
  }
}

// --- live races ----------------------------------------------------------------

// Four letters, none that read as another (no I/L/O/0/1).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export const LIVE_MAX_PLAYERS = 6
export const LIVE_HOURS = 3
const INBOX_MAX = 50 // messages waiting for one player: a handshake needs a few

export type LiveRoom = { code: string; course: GameCourse; host: string; createdAt: string }
export type LivePlayer = { id: string; name: string; joinedAt: string }
export type LiveMessage = { from: string; kind: 'offer' | 'answer'; sdp: string; at: string }

const roomKey = (code: string) => `games/live/${code}/meta.json`
const playerKey = (code: string, id: string) => `games/live/${code}/players/${id}.json`
const inboxPrefix = (code: string, id: string) => `games/live/${code}/inbox/${id}/`

export function raceCode(bytes = randomBytes(4)): string {
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

const fresh = (room: LiveRoom | null, now = Date.now()) =>
  room && now - Date.parse(room.createdAt) < LIVE_HOURS * 3600_000 ? room : null

export async function getRoom(code: string): Promise<LiveRoom | null> {
  return fresh(await getJson<LiveRoom>(roomKey(code)))
}

export async function createRoom(course: GameCourse, host: { id: string; name: string }): Promise<LiveRoom> {
  for (let tries = 0; tries < 10; tries++) {
    const code = raceCode()
    if (await getRoom(code)) continue
    const room: LiveRoom = { code, course, host: host.id, createdAt: new Date().toISOString() }
    await putJson(roomKey(code), room)
    await putJson(playerKey(code, host.id), { id: host.id, name: host.name, joinedAt: room.createdAt })
    return room
  }
  throw new Error('no free race code')
}

export async function listPlayers(code: string): Promise<LivePlayer[]> {
  const keys = await listKeys(`games/live/${code}/players/`)
  const players = await Promise.all(keys.map((k) => getJson<LivePlayer>(k)))
  return players.filter((p): p is LivePlayer => !!p).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
}

/** Joins a room; null if it's gone or full. Rejoining is fine (a reload). */
export async function joinRoom(code: string, player: { id: string; name: string }) {
  const room = await getRoom(code)
  if (!room) return null
  const players = await listPlayers(code)
  const already = players.find((p) => p.id === player.id)
  if (!already && players.length >= LIVE_MAX_PLAYERS) return null
  const me = already ?? { id: player.id, name: player.name, joinedAt: new Date().toISOString() }
  if (!already) await putJson(playerKey(code, player.id), me)
  return { room, players: already ? players : [...players, me] }
}

export async function sendMessage(code: string, to: string, message: Omit<LiveMessage, 'at'>) {
  const prefix = inboxPrefix(code, to)
  if ((await listKeys(prefix)).length >= INBOX_MAX) return false
  const at = new Date().toISOString()
  await putJson(`${prefix}${Date.now()}-${randomBytes(3).toString('hex')}.json`, { ...message, at })
  return true
}

/** Takes a player's waiting messages, oldest first, and empties the inbox. */
export async function takeMessages(code: string, id: string): Promise<LiveMessage[]> {
  const keys = (await listKeys(inboxPrefix(code, id))).sort()
  const messages = await Promise.all(keys.map((k) => getJson<LiveMessage>(k)))
  await Promise.all(keys.map((k) => deleteObject(k)))
  return messages.filter((m): m is LiveMessage => !!m)
}
