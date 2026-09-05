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
import { getJson, putJson, listKeys, deleteObject } from './storage'

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
