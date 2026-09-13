#!/usr/bin/env node
// Populate .local-data/ + cognito-local with realistic demo data.
// Run: pnpm seed   (after `pnpm cognito` is up and `pnpm cognito:init` has run)
// Wipes existing seed data before writing.

import fs from 'fs/promises'
import path from 'path'
import { nanoid } from 'nanoid'
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  ListUsersCommand,
  AdminDeleteUserCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { parseGpx } from '../src/lib/gpx'
import { processTrace, haversine } from '../src/lib/geo'
import { BOAT_CLASS_INFO, expectedSeats } from '../src/lib/types'
import type { CourseMetadata, TrialMetadata, GroupMetadata, LeaderboardEntry, BoatClass, CrewMember } from '../src/lib/types'

const ROOT = path.join(process.cwd(), '.local-data')

async function write(key: string, value: unknown) {
  const filePath = path.join(ROOT, key)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2))
}

async function writeRaw(key: string, content: string) {
  const filePath = path.join(ROOT, key)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

const ENDPOINT = process.env.COGNITO_ENDPOINT ?? 'http://localhost:9229'
const REGION = process.env.COGNITO_REGION ?? 'eu-west-1'
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
const CLIENT_ID = process.env.COGNITO_CLIENT_ID

if (!USER_POOL_ID || !CLIENT_ID) {
  console.error(
    '❌  Missing COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID. ' +
    'Run `pnpm cognito` then `pnpm cognito:init` first.'
  )
  process.exit(1)
}

const cognito = new CognitoIdentityProviderClient({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})

async function wipeCognitoUsers() {
  const list = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }))
  for (const u of list.Users ?? []) {
    if (!u.Username) continue
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: u.Username }))
  }
}

async function createCognitoUser(email: string, displayName: string, password: string): Promise<string> {
  try {
    const res = await cognito.send(new SignUpCommand({
      ClientId: CLIENT_ID!,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'name', Value: displayName },
      ],
    }))
    await cognito.send(new AdminConfirmSignUpCommand({ UserPoolId: USER_POOL_ID, Username: email }))
    return res.UserSub!
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      throw new Error(`User ${email} already exists in Cognito — run with a clean pool`)
    }
    throw err
  }
}

// --- GPX track generation ---

function rnd(scale: number): number {
  return (Math.random() - 0.5) * 2 * scale
}

function gpxPoint(lat: number, lng: number, time: Date): string {
  return `<trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"><time>${time.toISOString()}</time></trkpt>`
}

interface TrackParams {
  startLine: [[number, number], [number, number]]
  finishLine: [[number, number], [number, number]]
  elapsedSeconds: number
  raceStart: Date
}

function buildGpx(p: TrackParams): string {
  const smLat = (p.startLine[0][0] + p.startLine[1][0]) / 2
  const smLng = (p.startLine[0][1] + p.startLine[1][1]) / 2
  const fmLat = (p.finishLine[0][0] + p.finishLine[1][0]) / 2
  const fmLng = (p.finishLine[0][1] + p.finishLine[1][1]) / 2

  const latRate = (smLat - fmLat) / p.elapsedSeconds
  const lngRate = (smLng - fmLng) / p.elapsedSeconds
  const NOISE = 0.000009

  const pts: string[] = []

  for (let i = 25; i >= 1; i--) {
    const lat = smLat + i * latRate + rnd(NOISE)
    const lng = smLng + i * lngRate + rnd(NOISE)
    pts.push(gpxPoint(lat, lng, new Date(p.raceStart.getTime() - i * 1000)))
  }

  for (let i = 0; i <= p.elapsedSeconds; i++) {
    const lat = smLat - i * latRate + rnd(NOISE)
    const lng = smLng - i * lngRate + rnd(NOISE)
    const t = new Date(p.raceStart.getTime() + i * 1000)
    pts.push(gpxPoint(lat, lng, t))
  }

  for (let i = 1; i <= 15; i++) {
    const lat = fmLat - i * latRate + rnd(NOISE)
    const lng = fmLng - i * lngRate + rnd(NOISE)
    pts.push(gpxPoint(lat, lng, new Date(p.raceStart.getTime() + (p.elapsedSeconds + i) * 1000)))
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="rrc-tt-seed" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><trkseg>
${pts.map(p => '    ' + p).join('\n')}
  </trkseg></trk>
</gpx>`
}

// --- Data definitions ---

const PASSWORD = 'Password123'

const USERS = [
  { email: 'admin@rrc-tt.is',     displayName: 'Admin User',               isAdmin: true  },
  { email: 'sigridur@example.is', displayName: 'Sigríður Björnsdóttir',    isAdmin: false },
  { email: 'gunnar@example.is',   displayName: 'Gunnar Sigurðsson',        isAdmin: false },
  { email: 'helga@example.is',    displayName: 'Helga Kristjánsdóttir',    isAdmin: false },
  { email: 'arni@example.is',     displayName: 'Árni Magnússon',           isAdmin: false },
  { email: 'eva@example.is',      displayName: 'Eva Þórðardóttir',         isAdmin: false },
  { email: 'bjarni@example.is',   displayName: 'Bjarni Jónsson',           isAdmin: false },
  { email: 'ragnhild@example.is', displayName: 'Ragnhild Andersen',        isAdmin: false },
]

const C1_START: [[number, number], [number, number]] = [[64.0850, -21.8350], [64.0850, -21.8310]]
const C1_FINISH: [[number, number], [number, number]] = [[64.0760, -21.8350], [64.0760, -21.8310]]
const C2_START: [[number, number], [number, number]] = [[64.1525, -22.0100], [64.1515, -22.0100]]
const C2_FINISH: [[number, number], [number, number]] = [[64.1525, -22.0203], [64.1515, -22.0203]]

function midpoint(line: [[number, number], [number, number]]): [number, number] {
  return [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2]
}

async function main() {
  console.log('🧹  Wiping .local-data/ and Cognito users …')
  await fs.rm(ROOT, { recursive: true, force: true })
  await wipeCognitoUsers()

  console.log('🌱  Seeding cognito-local + .local-data/ …\n')

  // 1. Users — create in Cognito, the sub becomes our app user id
  const userMap: Record<string, { id: string; email: string; displayName: string }> = {}
  for (const u of USERS) {
    const sub = await createCognitoUser(u.email, u.displayName, PASSWORD)
    userMap[u.email] = { id: sub, email: u.email, displayName: u.displayName }
    console.log(`  user  ${u.displayName} <${u.email}>`)
  }

  const admin = userMap['admin@rrc-tt.is']

  // 1b. A group owns the seeded courses + trials (phase 2: only group admins
  // create content). Admin is owner; everyone else is a member so phase-3
  // member-gated submission has demo data to work with.
  const groupId = nanoid()
  const group: GroupMetadata = {
    id: groupId,
    name: 'Reykjavík Rowing Club',
    description: 'Demo group that owns the seeded courses and trials.',
    ownerId: admin.id,
    adminUserIds: [],
    memberUserIds: Object.values(userMap).filter(u => u.id !== admin.id).map(u => u.id),
    createdAt: '2025-02-20T09:00:00.000Z',
  }
  await write(`groups/${groupId}/metadata.json`, group)
  for (const u of Object.values(userMap)) {
    await write(`users/${u.id}/groups.json`, { groupIds: [groupId] })
  }
  console.log(`  group  ${group.name}  (owner: ${admin.displayName}, ${group.memberUserIds.length} members)`)

  // 2. Courses
  const c1Id = nanoid()
  const c1: CourseMetadata = {
    id: c1Id,
    name: 'Elliðaár 1000m Sprint',
    sport: 'both',
    type: 'point_to_point',
    startLine: C1_START,
    finishLine: C1_FINISH,
    distanceMetres: Math.round(haversine(midpoint(C1_START), midpoint(C1_FINISH))),
    groupId,
    adminUserId: admin.id,
    visibility: 'public',
    createdAt: '2025-03-01T09:00:00.000Z',
  }
  await write(`courses/${c1Id}/metadata.json`, c1)
  console.log(`\n  course ${c1.name}  (${c1.distanceMetres} m)`)

  const c2Id = nanoid()
  const c2: CourseMetadata = {
    id: c2Id,
    name: 'Reykjavik Harbour 500m',
    sport: 'kayak',
    type: 'point_to_point',
    startLine: C2_START,
    finishLine: C2_FINISH,
    distanceMetres: Math.round(haversine(midpoint(C2_START), midpoint(C2_FINISH))),
    groupId,
    adminUserId: admin.id,
    visibility: 'public',
    createdAt: '2025-03-15T09:00:00.000Z',
  }
  await write(`courses/${c2Id}/metadata.json`, c2)
  console.log(`  course ${c2.name}  (${c2.distanceMetres} m)`)

  // 3. Trials
  const t1Id = nanoid()
  const trial1: TrialMetadata = {
    id: t1Id, courseId: c1Id,
    name: 'Spring Sprint 2025',
    date: '2025-04-12', status: 'closed',
    groupId,
    adminUserId: admin.id,
    visibility: 'public',
    participation: 'public',
    invitedUserIds: [],
    createdAt: '2025-04-01T08:00:00.000Z',
  }
  await write(`trials/${t1Id}/metadata.json`, trial1)

  const t2Id = nanoid()
  const trial2: TrialMetadata = {
    id: t2Id, courseId: c1Id,
    name: 'Summer Championships 2025',
    date: '2025-07-19', status: 'closed',
    groupId,
    adminUserId: admin.id,
    visibility: 'public',
    participation: 'public',
    invitedUserIds: [],
    createdAt: '2025-07-01T08:00:00.000Z',
  }
  await write(`trials/${t2Id}/metadata.json`, trial2)

  const t3Id = nanoid()
  const trial3: TrialMetadata = {
    id: t3Id, courseId: c2Id,
    name: 'Harbour Race 2025',
    date: '2025-06-07', status: 'open',
    groupId,
    adminUserId: admin.id,
    visibility: 'public',
    participation: 'members',
    invitedUserIds: [],
    createdAt: '2025-05-20T08:00:00.000Z',
  }
  await write(`trials/${t3Id}/metadata.json`, trial3)

  console.log('\n  trials: Spring Sprint (closed), Summer Champs (closed), Harbour Race (open)')

  // 4. Entries
  type EntrySpec = {
    userEmail: string
    elapsedSeconds: number
    raceStart: Date
    boatClass: BoatClass
  }

  async function addEntry(
    trialId: string,
    startLine: [[number, number], [number, number]],
    finishLine: [[number, number], [number, number]],
    spec: EntrySpec
  ): Promise<LeaderboardEntry | null> {
    const user = userMap[spec.userEmail]
    const gpx = buildGpx({
      startLine, finishLine,
      elapsedSeconds: spec.elapsedSeconds,
      raceStart: spec.raceStart,
    })

    const track = parseGpx(gpx)
    const result = processTrace(track, startLine, finishLine)
    if (!result) {
      console.error(`  ❌  processTrace returned null for ${user.displayName}`)
      return null
    }

    const entryId = nanoid()
    const basePath = `trials/${trialId}/entries/${user.id}/${entryId}`
    await writeRaw(`${basePath}/trace.gpx`, gpx)

    // Build a plausible crew. Singles get the submitter at seat 1; larger boats
    // get the submitter + filler names drawn from the rest of the user pool.
    const crew = buildSeedCrew(spec.boatClass, user.displayName)

    const raceDate = spec.raceStart.toISOString().slice(0, 10)
    const traceRecordedDate = raceDate // seed always has matching dates — no discrepancy
    const stored = {
      entryId, userId: user.id, displayName: user.displayName,
      submittedAt: new Date(spec.raceStart.getTime() + spec.elapsedSeconds * 1000 + 60_000).toISOString(),
      filename: 'trace.gpx',
      raceDate,
      traceRecordedDate,
      dateDiscrepancy: false,
      boatClass: spec.boatClass,
      crew,
      result,
    }
    await write(`${basePath}/result.json`, stored)

    return {
      entryId, userId: user.id, displayName: user.displayName,
      submittedAt: stored.submittedAt,
      raceDate,
      boatClass: spec.boatClass,
      crew,
      totalElapsedSeconds: result.totalElapsedSeconds,
      splits: result.splits,
    }
  }

  function buildSeedCrew(boatClass: BoatClass, submitterName: string): CrewMember[] {
    const seats = expectedSeats(boatClass)
    const others = Object.values(userMap)
      .map(u => u.displayName)
      .filter(n => n !== submitterName)
    const fill = [...others]
    return seats.map((seat, i) => ({
      seat,
      name: i === 0 ? submitterName : (fill.shift() ?? `Crew ${i + 1}`),
    }))
  }

  async function buildLeaderboard(trialId: string, entries: LeaderboardEntry[]) {
    const sorted = [...entries].sort((a, b) => a.totalElapsedSeconds - b.totalElapsedSeconds)
    await write(`trials/${trialId}/leaderboard.json`, sorted)
  }

  console.log('\n  entries: Spring Sprint 2025')
  const t1Base = new Date('2025-04-12T10:00:00.000Z')
  const t1Entries: LeaderboardEntry[] = []
  // Mix of singles + multi-person crews so the leaderboard demonstrates both
  for (const [email, secs, boatClass] of [
    ['sigridur@example.is', 285, 'K1'],
    ['gunnar@example.is',   289, 'K2'],   // K2: gunnar + a crewmate
    ['helga@example.is',    298, '1X'],
    ['arni@example.is',     307, 'K1'],
    ['eva@example.is',      315, '2X'],   // 2X scull: eva + a crewmate
    ['bjarni@example.is',   324, 'K1'],
  ] as [string, number, BoatClass][]) {
    const e = await addEntry(t1Id, C1_START, C1_FINISH, {
      userEmail: email, elapsedSeconds: secs,
      raceStart: new Date(t1Base.getTime() + t1Entries.length * 5 * 60_000),
      boatClass,
    })
    if (e) {
      t1Entries.push(e)
      console.log(`    ${userMap[email].displayName.padEnd(28)} ${boatClass.padEnd(4)} ${(e.totalElapsedSeconds / 60).toFixed(2)} min`)
    }
  }
  await buildLeaderboard(t1Id, t1Entries)

  console.log('\n  entries: Summer Championships 2025')
  const t2Base = new Date('2025-07-19T09:30:00.000Z')
  const t2Entries: LeaderboardEntry[] = []
  for (const [email, secs, boatClass] of [
    ['gunnar@example.is',   287, 'K1'],
    ['sigridur@example.is', 293, 'K1'],
    ['ragnhild@example.is', 295, '4-'], // 4- sweep: ragnhild + 3 crewmates
    ['helga@example.is',    311, '1X'],
  ] as [string, number, BoatClass][]) {
    const e = await addEntry(t2Id, C1_START, C1_FINISH, {
      userEmail: email, elapsedSeconds: secs,
      raceStart: new Date(t2Base.getTime() + t2Entries.length * 5 * 60_000),
      boatClass,
    })
    if (e) {
      t2Entries.push(e)
      console.log(`    ${userMap[email].displayName.padEnd(28)} ${boatClass.padEnd(4)} ${(e.totalElapsedSeconds / 60).toFixed(2)} min`)
    }
  }
  await buildLeaderboard(t2Id, t2Entries)

  console.log('\n  entries: Harbour Race 2025')
  const t3Base = new Date('2025-06-07T11:00:00.000Z')
  const t3Entries: LeaderboardEntry[] = []
  // Course is kayak-only — all entries in K1/K2
  for (const [email, secs, boatClass] of [
    ['sigridur@example.is', 142, 'K1'],
    ['eva@example.is',      148, 'K1'],
    ['gunnar@example.is',   155, 'K1'],
  ] as [string, number, BoatClass][]) {
    const e = await addEntry(t3Id, C2_START, C2_FINISH, {
      userEmail: email, elapsedSeconds: secs,
      raceStart: new Date(t3Base.getTime() + t3Entries.length * 4 * 60_000),
      boatClass,
    })
    if (e) {
      t3Entries.push(e)
      console.log(`    ${userMap[email].displayName.padEnd(28)} ${boatClass.padEnd(4)} ${(e.totalElapsedSeconds / 60).toFixed(2)} min`)
    }
  }
  await buildLeaderboard(t3Id, t3Entries)

  console.log(`
✅  Done. All users have password: ${PASSWORD}
    Log in at http://localhost:3000/att/auth
    Admin account: admin@rrc-tt.is
`)
}

main().catch(err => { console.error(err); process.exit(1) })
