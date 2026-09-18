// Hardware tracker binding + identity (docs/features/device-uplink.md).
//
// A headless device (LilyGO T-Beam S3 Supreme) has no browser/cookie, so it
// can't use getAuthUser(). Instead it runs a TV-style pairing flow: it POSTs a
// claim, shows a short code on its OLED, the signed-in user types that code on
// the website, and the device's next poll collects a per-device bearer token.
//
// Security posture (all enforced here):
//   - claimSecret / deviceToken are returned once and stored only as sha256
//     hashes, so a bucket leak yields no usable credential.
//   - the claimSecret is compared in constant time.
//   - claims are single-use and TTL-bounded (10 min).
//   - `deviceId` is NOT a secret (it's on every LoRa packet) — it authenticates
//     nothing on its own.
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { getJson, putJson, getObject, putObject, listKeys, deleteObject } from './storage'

export type DeviceClaim = {
  claimCode: string
  claimSecretHash: string
  deviceId: string
  model: string
  firmware: string
  createdAt: string
  expiresAt: string
  userId?: string     // set once the user enters the code (link step)
  name?: string
  consumedAt?: string // set once the token has been collected — a tombstone so a
                      // repeat /token poll returns 410 rather than looking unclaimed
}
export type DeviceTokenRecord = { deviceId: string; userId: string; createdAt: string; lastSeenAt: string }
export type DeviceRecord = {
  deviceId: string; userId: string; name: string; model: string; firmware: string
  linkedAt: string; lastSeenAt: string
  tokenHash: string   // sha256(token) — lets the owner revoke the token record
}
export type DeviceAuth = { deviceId: string; userId: string }

const CLAIM_TTL_MS = 10 * 60 * 1000
// No 0/O, 1/I, U/V — the code is read off a tiny mono OLED and typed by hand.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

const claimKey = (code: string) => `device-claims/${code}.json`
const tokenKey = (tokenHash: string) => `device-tokens/${tokenHash}.json`
const deviceKey = (deviceId: string) => `devices/${deviceId}/metadata.json`

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const nowIso = () => new Date().toISOString()

// Constant-time compare of two hex digests (equal length by construction).
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')) } catch { return false }
}

function randomCode(): string {
  const bytes = randomBytes(6)
  let out = ''
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

export function isDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9A-F]{8}$/.test(v)
}

// Start a claim. Returns the code (shown on the OLED) + the secret (held only by
// the device, returned once). The secret is stored hashed.
export async function createClaim(deviceId: string, model: string, firmware: string): Promise<{ claimCode: string; claimSecret: string; expiresAt: string }> {
  // Avoid clobbering a live code (collisions are astronomically rare; retry a few).
  let claimCode = randomCode()
  for (let i = 0; i < 5 && (await getJson<DeviceClaim>(claimKey(claimCode))); i++) claimCode = randomCode()
  const claimSecret = randomBytes(32).toString('base64url')
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString()
  const record: DeviceClaim = { claimCode, claimSecretHash: sha256(claimSecret), deviceId, model, firmware, createdAt, expiresAt }
  await putJson(claimKey(claimCode), record)
  return { claimCode, claimSecret, expiresAt }
}

const isExpired = (c: DeviceClaim) => Date.now() > Date.parse(c.expiresAt)

// The browser (authenticated) half: the user types the code. Binds the claim to
// their account. Does not mint the token — the device collects that on its next
// poll (so the secret never has to travel to the browser).
export async function linkClaim(claimCode: string, userId: string, name?: string): Promise<{ deviceId: string; model: string } | { error: 'unknown_code' | 'claim_expired' | 'already_linked' }> {
  const c = await getJson<DeviceClaim>(claimKey(claimCode))
  if (!c) return { error: 'unknown_code' }
  if (isExpired(c)) { await deleteObject(claimKey(claimCode)); return { error: 'claim_expired' } }
  if (c.userId) return { error: 'already_linked' }
  c.userId = userId
  if (name) c.name = name
  await putJson(claimKey(claimCode), c)
  return { deviceId: c.deviceId, model: c.model }
}

type RedeemResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'bound'; deviceToken: string; userId: string; deviceName?: string }

// The device polls with { deviceId, claimSecret }. We find its pending claim by
// matching the deviceId AND a constant-time secret check, so a wrong secret is
// indistinguishable from "not entered yet" (both → pending). On success: mint
// the token, write the device record, consume the claim (single use).
export async function redeemToken(deviceId: string, claimSecret: string): Promise<RedeemResult> {
  const secretHash = sha256(claimSecret)
  const keys = await listKeys('device-claims/')
  for (const key of keys) {
    const c = await getJson<DeviceClaim>(key)
    if (!c || c.deviceId !== deviceId) continue
    if (!hexEqual(c.claimSecretHash, secretHash)) continue
    // Consumed (single-use) or expired → 410. We keep a consumed tombstone
    // rather than hard-deleting on success, so a repeat poll returns 410 not a
    // misleading "pending"; it's swept once past its TTL.
    if (c.consumedAt || isExpired(c)) {
      if (Date.now() > Date.parse(c.expiresAt)) await deleteObject(key)
      return { status: 'expired' }
    }
    if (!c.userId) return { status: 'pending' }
    const token = randomBytes(32).toString('base64url')
    const tokenHash = sha256(token)
    const ts = nowIso()
    await putJson(tokenKey(tokenHash), { deviceId, userId: c.userId, createdAt: ts, lastSeenAt: ts } satisfies DeviceTokenRecord)
    await putJson(deviceKey(deviceId), {
      deviceId, userId: c.userId, name: c.name ?? `Tracker ${deviceId}`, model: c.model, firmware: c.firmware,
      linkedAt: ts, lastSeenAt: ts, tokenHash,
    } satisfies DeviceRecord)
    c.consumedAt = ts
    await putJson(key, c)  // tombstone — single use, repeat poll → 410
    return { status: 'bound', deviceToken: token, userId: c.userId, deviceName: c.name }
  }
  return { status: 'pending' }  // no match — never reveal that the device/secret was wrong
}

// Resolve a bearer token to its device+user, or null. Best-effort lastSeenAt bump.
export async function resolveDeviceToken(token: string): Promise<DeviceAuth | null> {
  if (!token) return null
  const rec = await getJson<DeviceTokenRecord>(tokenKey(sha256(token)))
  if (!rec) return null
  try { rec.lastSeenAt = nowIso(); await putJson(tokenKey(sha256(token)), rec) } catch { /* non-fatal */ }
  return { deviceId: rec.deviceId, userId: rec.userId }
}

// The signed-in user's devices (owner-filtered).
export async function listUserDevices(userId: string): Promise<DeviceRecord[]> {
  const keys = await listKeys('devices/')
  const all = await Promise.all(keys.filter(k => k.endsWith('/metadata.json')).map(k => getJson<DeviceRecord>(k)))
  return all.filter((d): d is DeviceRecord => !!d && d.userId === userId)
    .sort((a, b) => (b.lastSeenAt > a.lastSeenAt ? 1 : -1))
}

// Revoke a device the caller owns: delete its token record (→ device gets 401 on
// next sync and re-claims) and its metadata. Returns false if not owned/found.
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  if (!isDeviceId(deviceId)) return false
  const d = await getJson<DeviceRecord>(deviceKey(deviceId))
  if (!d || d.userId !== userId) return false
  if (d.tokenHash) await deleteObject(tokenKey(d.tokenHash))
  await deleteObject(deviceKey(deviceId))
  return true
}

// ── Device sessions (uploads) ────────────────────────────────────────────────
// Raw traces the device uploaded, stored like every other collection. The device
// only lands the raw CSV + light metadata here; the Analyse app parses + analyses
// on demand (exactly like ATT trial entries), so a device paddle is just another
// importable source.

export type DeviceSessionMeta = {
  sessionId: string; deviceId: string; userId: string; filename: string
  uploadedAt: string
  startedAt?: string; endedAt?: string; distanceMetres?: number; points: number
  // Set once the matching `_imu.csv` sidecar has been uploaded for this session.
  motion?: { uploadedAt: string; bytes: number; rows: number }
}

/**
 * `track_<stamp>_imu.csv` -> `track_<stamp>.csv`, or null if this isn't a sidecar.
 *
 * The sidecar is addressed by the TRACK it belongs to. A sidecar can only be
 * stored against an already-uploaded track, which also gives the device a clear
 * ordering rule: tracks first, then sidecars.
 */
export function motionSidecarTrackName(filename: string): string | null {
  const m = /^(.+)_imu\.csv$/i.exec(filename)
  return m ? `${m[1]}.csv` : null
}

const sessionMetaKey = (deviceId: string, sessionId: string) => `devices/${deviceId}/sessions/${sessionId}/session.json`
const sessionTraceKey = (deviceId: string, sessionId: string) => `devices/${deviceId}/sessions/${sessionId}/trace.csv`
// The decimated motion sidecar, stored beside the track it belongs to rather than
// as a session of its own — it is not a paddle, it is extra channels for one.
const sessionMotionKey = (deviceId: string, sessionId: string) => `devices/${deviceId}/sessions/${sessionId}/motion.csv`
// Idempotency index: a device numbers files monotonically and never reuses a
// name, so deviceId+filename is a stable identity — a retry after a dropped
// response can't create a duplicate.
const uploadIndexKey = (deviceId: string, filename: string) => `devices/${deviceId}/uploads/${filename}.json`

// 64 KB chunks put a 4 MB file at ~64 parts. This ceiling is a sanity bound on
// the assembly loop, not a product limit.
const MAX_MOTION_PARTS = 512

const safeName = (s: string) => /^[\w.-]{1,128}$/.test(s)

// Returns the existing sessionId if this device+filename was already uploaded.
export async function findUploadedSession(deviceId: string, filename: string): Promise<string | null> {
  if (!isDeviceId(deviceId) || !safeName(filename)) return null
  const idx = await getJson<{ sessionId: string }>(uploadIndexKey(deviceId, filename))
  return idx?.sessionId ?? null
}

// Persist a device upload: raw CSV + metadata + the idempotency index.
export async function storeDeviceSession(
  meta: Omit<DeviceSessionMeta, 'sessionId' | 'uploadedAt'>,
  csv: Buffer | string,
): Promise<DeviceSessionMeta> {
  const sessionId = randomBytes(9).toString('base64url')
  const full: DeviceSessionMeta = { ...meta, sessionId, uploadedAt: nowIso() }
  await putObject(sessionTraceKey(meta.deviceId, sessionId), csv)
  await putJson(sessionMetaKey(meta.deviceId, sessionId), full)
  await putJson(uploadIndexKey(meta.deviceId, meta.filename), { sessionId })
  return full
}

/**
 * Attaches a decimated motion sidecar to an already-uploaded session.
 *
 * Returns 'no_track' when the track it names hasn't been uploaded yet — the
 * device should send the track first and retry, rather than us inventing an
 * orphan session with no position data in it.
 */
export async function storeDeviceMotion(
  deviceId: string,
  userId: string,
  trackFilename: string,
  csv: Buffer | string,
  rows: number,
): Promise<DeviceSessionMeta | 'no_track'> {
  if (!isDeviceId(deviceId) || !safeName(trackFilename)) return 'no_track'
  const sessionId = await findUploadedSession(deviceId, trackFilename)
  if (!sessionId) return 'no_track'
  const meta = await getJson<DeviceSessionMeta>(sessionMetaKey(deviceId, sessionId))
  if (!meta || meta.userId !== userId) return 'no_track'

  const bytes = typeof csv === 'string' ? Buffer.byteLength(csv) : csv.length
  await putObject(sessionMotionKey(deviceId, sessionId), csv)
  const updated: DeviceSessionMeta = { ...meta, motion: { uploadedAt: nowIso(), bytes, rows } }
  await putJson(sessionMetaKey(deviceId, sessionId), updated)
  return updated
}

// Staging for a chunked upload of ANY file, keyed by filename rather than by
// session — a track has no session until it has been assembled and parsed, so
// keying by session cannot work for the file that matters most.
const uploadPartKey = (deviceId: string, filename: string, part: number) =>
  `devices/${deviceId}/parts/${filename}/${String(part).padStart(4, '0')}`

export type UploadPartResult =
  | { status: 'bad_request' }
  | { status: 'stored'; have: number; parts: number }
  | { status: 'incomplete'; missing: number[]; parts: number }
  | { status: 'corrupt'; expected: string; actual: string }
  | { status: 'assembled'; body: Buffer }

/**
 * Stores one chunk of any upload, and hands back the whole file once the last
 * one lands.
 *
 * Chunking is a TRANSPORT concern and nothing else: this knows nothing about
 * tracks or sidecars, and the caller runs its normal handling on the assembled
 * buffer. The first version of this was tangled into motion storage, which meant
 * tracks could not use it — and since a sidecar cannot attach until its track is
 * up, the file that most needed chunking was the one that could not have it.
 *
 * Why chunks: the device cannot read a large file off its own SD card in one go
 * while HTTP is in flight. Why plain objects rather than S3 multipart: S3 objects
 * are immutable, and multipart requires every part but the last to be >= 5 MB,
 * larger than these whole files.
 */
export async function storeUploadPart(
  deviceId: string,
  filename: string,
  part: number,
  parts: number,
  chunk: Buffer,
  sha256Hex?: string,
): Promise<UploadPartResult> {
  if (!isDeviceId(deviceId) || !safeName(filename)) return { status: 'bad_request' }
  if (!Number.isInteger(part) || !Number.isInteger(parts)) return { status: 'bad_request' }
  if (part < 1 || parts < 1 || part > parts || parts > MAX_MOTION_PARTS) return { status: 'bad_request' }

  // Idempotent by index: a retried chunk overwrites, so a reboot mid-sync resumes.
  await putObject(uploadPartKey(deviceId, filename, part), chunk)
  if (part !== parts) {
    const have = (await listKeys(`devices/${deviceId}/parts/${filename}/`)).length
    return { status: 'stored', have, parts }
  }

  // Last part: assemble, but only once every index is actually present — a
  // retried part can arrive after the final one.
  const buffers: Buffer[] = []
  const missing: number[] = []
  for (let i = 1; i <= parts; i++) {
    const b = await getObject(uploadPartKey(deviceId, filename, i))
    if (!b) missing.push(i)
    else buffers.push(b)
  }
  if (missing.length) return { status: 'incomplete', missing, parts }

  const body = Buffer.concat(buffers)
  if (sha256Hex) {
    const actual = createHash('sha256').update(body).digest('hex')
    if (!hexEqual(actual, sha256Hex.toLowerCase())) {
      return { status: 'corrupt', expected: sha256Hex.toLowerCase(), actual }
    }
  }
  return { status: 'assembled', body }
}

/** Drops the staged parts once the caller has successfully handled the whole file. */
export async function clearUploadParts(deviceId: string, filename: string, parts: number): Promise<void> {
  for (let i = 1; i <= parts; i++) await deleteObject(uploadPartKey(deviceId, filename, i))
}

// One chunk of a motion sidecar, awaiting assembly. Zero-padded so a plain
// lexicographic key listing is already in part order.
const motionPartKey = (deviceId: string, sessionId: string, part: number) =>
  `devices/${deviceId}/sessions/${sessionId}/motion.parts/${String(part).padStart(4, '0')}`

export type MotionPartResult =
  | { status: 'no_track' }
  | { status: 'stored'; have: number; parts: number }
  | { status: 'incomplete'; have: number; parts: number; missing: number[] }
  | { status: 'assembled'; meta: DeviceSessionMeta; bytes: number }
  | { status: 'corrupt'; expected: string; actual: string }

/**
 * Stores one chunk of a motion sidecar, and assembles the file once the last one
 * lands.
 *
 * Why chunks at all: the device cannot get a large file off its own SD card in
 * one go — reads stall after ~90 KB while the radio is associated, so a 2.4 MB
 * sidecar never even reaches the socket. Small chunks are short reads with idle
 * gaps between them, which sidesteps that as well as the transfer itself.
 *
 * Why parts-as-objects rather than S3 multipart: S3 objects are immutable (there
 * is no append), and multipart upload requires every part except the last to be
 * at least 5 MB — larger than this entire file. So parts are ordinary objects and
 * the final call concatenates them. At these sizes that is a couple of MB through
 * Lambda memory and costs nothing; it would be the wrong shape at 100x.
 *
 * Assembly is triggered by the LAST part arriving but verifies that every index
 * is present rather than assuming ordered delivery — a retried part can arrive
 * after it. `sha256` is checked over the assembled whole, because concatenating
 * from pieces introduces a way to silently produce a wrong file that a single PUT
 * never had.
 */
export async function storeMotionPart(
  deviceId: string,
  userId: string,
  trackFilename: string,
  part: number,
  parts: number,
  chunk: Buffer,
  sha256Hex?: string,
): Promise<MotionPartResult> {
  if (!isDeviceId(deviceId) || !safeName(trackFilename)) return { status: 'no_track' }
  if (!Number.isInteger(part) || !Number.isInteger(parts)) return { status: 'no_track' }
  if (part < 1 || parts < 1 || part > parts || parts > MAX_MOTION_PARTS) return { status: 'no_track' }

  const sessionId = await findUploadedSession(deviceId, trackFilename)
  if (!sessionId) return { status: 'no_track' }
  const meta = await getJson<DeviceSessionMeta>(sessionMetaKey(deviceId, sessionId))
  if (!meta || meta.userId !== userId) return { status: 'no_track' }

  // Idempotent by index: a retried chunk overwrites rather than duplicating, so a
  // device that reboots mid-sync resumes instead of starting over.
  await putObject(motionPartKey(deviceId, sessionId, part), chunk)

  const prefix = `devices/${deviceId}/sessions/${sessionId}/motion.parts/`
  const have = (await listKeys(prefix)).length
  if (part !== parts) return { status: 'stored', have, parts }

  // Last part: assemble, but only if every index is actually present.
  const buffers: Buffer[] = []
  const missing: number[] = []
  for (let i = 1; i <= parts; i++) {
    const b = await getObject(motionPartKey(deviceId, sessionId, i))
    if (!b) missing.push(i)
    else buffers.push(b)
  }
  if (missing.length) return { status: 'incomplete', have, parts, missing }

  const full = Buffer.concat(buffers)
  if (sha256Hex) {
    const actual = createHash('sha256').update(full).digest('hex')
    if (!hexEqual(actual, sha256Hex.toLowerCase())) {
      return { status: 'corrupt', expected: sha256Hex.toLowerCase(), actual }
    }
  }

  await putObject(sessionMotionKey(deviceId, sessionId), full)
  const updated: DeviceSessionMeta = {
    ...meta,
    motion: { uploadedAt: nowIso(), bytes: full.length, rows: countMotionRows(full) },
  }
  await putJson(sessionMetaKey(deviceId, sessionId), updated)
  // Only now drop the parts: if anything above threw, a retry can still assemble.
  for (let i = 1; i <= parts; i++) await deleteObject(motionPartKey(deviceId, sessionId, i))
  return { status: 'assembled', meta: updated, bytes: full.length }
}

// Data rows in a motion CSV — the header and any blank line don't count. Kept
// here rather than importing the timing package: core must not depend on it.
function countMotionRows(buf: Buffer): number {
  let n = 0
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    const c = line.indexOf(',')
    if (c > 0 && Number.isFinite(Number(line.slice(0, c)))) n++
  }
  return n
}

// The stored motion sidecar for one of the user's sessions, or null.
export async function getDeviceSessionMotion(userId: string, deviceId: string, sessionId: string): Promise<Buffer | null> {
  if (!isDeviceId(deviceId)) return null
  const meta = await getJson<DeviceSessionMeta>(sessionMetaKey(deviceId, sessionId))
  if (!meta || meta.userId !== userId || !meta.motion) return null
  return getObject(sessionMotionKey(deviceId, sessionId))
}

// The signed-in user's device uploads, newest first (owner-filtered).
export async function listUserDeviceSessions(userId: string): Promise<DeviceSessionMeta[]> {
  const keys = await listKeys('devices/')
  const metas = await Promise.all(keys.filter(k => k.endsWith('/session.json')).map(k => getJson<DeviceSessionMeta>(k)))
  return metas.filter((m): m is DeviceSessionMeta => !!m && m.userId === userId)
    .sort((a, b) => (b.uploadedAt > a.uploadedAt ? 1 : -1))
}

// The raw stored CSV for one of the user's device sessions, or null if it isn't
// theirs / doesn't exist. The caller parses it (keeps core parser-agnostic).
export async function getDeviceSessionTrace(userId: string, deviceId: string, sessionId: string): Promise<Buffer | null> {
  if (!isDeviceId(deviceId)) return null
  const meta = await getJson<DeviceSessionMeta>(sessionMetaKey(deviceId, sessionId))
  if (!meta || meta.userId !== userId) return null
  return getObject(sessionTraceKey(deviceId, sessionId))
}
