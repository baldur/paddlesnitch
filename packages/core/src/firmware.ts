// Firmware distribution for the hardware tracker — the server half of OTA.
// See docs/features/device-ota-and-auth.md (Phase 1).
//
// Two ideas shape this file:
//
// 1. **Uploading a build is not releasing it.** A build lands at
//    `firmware/<version>/` and is invisible to every device until someone
//    promotes it by writing `firmware/channels/stable.json`. Those are separate
//    actions with separate permissions (see .github/workflows/firmware-release.yml),
//    because conflating them means a bad commit reaches every device.
//
// 2. **Signal, don't probe.** The channel version rides along on responses the
//    device was already receiving (`X-PS-Firmware`), so in the steady state a
//    device makes no firmware requests at all. That header is served on every
//    device-authenticated response, which makes `getChannelVersion` the hottest
//    read in the system — hence the in-process cache below.
import { createHash } from 'crypto'
import { getJson, putJson, getObject, listKeys, presignGetUrl } from './storage'

export type FirmwareChannel = 'stable' | 'beta'
export const FIRMWARE_CHANNELS: readonly FirmwareChannel[] = ['stable', 'beta']

export type FirmwareManifest = {
  version: string
  sha256: string
  sizeBytes: number
  notes: string
  builtAt: string
  gitSha?: string
}

export type FirmwareOfferedRecord = {
  at: string
  fromVersion: string | null
  ip?: string
  userAgent?: string
}

export type FirmwareBootedRecord = {
  at: string
  fromVersion: string | null
  bootOk: boolean
  rolledBack: boolean
  resetReason?: string
}

/** How long a firmware download URL stays valid. Long enough for a slow device
 *  on a domestic uplink to pull ~1.1 MB; short enough that a leaked URL is not a
 *  standing grant. */
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60

// ---------------------------------------------------------------------------
// Keys + validation
// ---------------------------------------------------------------------------

// `version` reaches us from a device-supplied query string and then goes into a
// storage key, so it is validated as a strict semver rather than merely escaped.
// Anything with a slash or a dot-segment is rejected outright.
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/

export function isFirmwareVersion(v: unknown): v is string {
  return typeof v === 'string' && SEMVER.test(v)
}

export function isFirmwareChannel(v: unknown): v is FirmwareChannel {
  return typeof v === 'string' && (FIRMWARE_CHANNELS as readonly string[]).includes(v)
}

export const firmwareBinaryKey = (version: string) => `firmware/${version}/firmware.bin`
export const firmwareManifestKey = (version: string) => `firmware/${version}/manifest.json`
export const firmwareChannelKey = (channel: FirmwareChannel) => `firmware/channels/${channel}.json`
const offeredKey = (deviceId: string, version: string) => `firmware-events/${deviceId}/${version}/offered.json`
const bootedKey = (deviceId: string, version: string) => `firmware-events/${deviceId}/${version}/booted.json`

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// The channel pointer (the hot read)
// ---------------------------------------------------------------------------

// `X-PS-Firmware` goes on every device-authenticated response, including each of
// the ~48 chunk responses in a single sync, so this must not be a storage read
// per request. A Lambda container survives many requests, so a short TTL cache
// turns a sync's worth of reads into roughly one.
//
// The TTL is the cost of promoting: a release takes up to CHANNEL_CACHE_MS to
// reach a warm container. 60 s against a device that syncs every 5 minutes is
// not a meaningful delay, and it bounds the read volume.
const CHANNEL_CACHE_MS = 60_000
type CacheEntry = { version: string | null; at: number }
const channelCache = new Map<FirmwareChannel, CacheEntry>()

/** The version a channel currently points at, or null when nothing is promoted
 *  (which is the normal state until the first release). Never throws — a storage
 *  failure must not break the upload the device was actually making. */
export async function getChannelVersion(channel: FirmwareChannel = 'stable'): Promise<string | null> {
  const hit = channelCache.get(channel)
  if (hit && Date.now() - hit.at < CHANNEL_CACHE_MS) return hit.version
  let version: string | null = null
  try {
    const doc = await getJson<{ version?: string }>(firmwareChannelKey(channel))
    version = isFirmwareVersion(doc?.version) ? doc!.version! : null
  } catch {
    // Fall through to null: no signal is strictly better than a wrong one, and
    // the device simply keeps running what it has.
    version = null
  }
  channelCache.set(channel, { version, at: Date.now() })
  return version
}

/** Test seam — the cache is process-global, so a test that promotes a version
 *  must be able to drop it. */
export function __clearChannelCache() { channelCache.clear() }

// ---------------------------------------------------------------------------
// Publishing (used by the release workflow / scripts, never by a device route)
// ---------------------------------------------------------------------------

/** Store a built image + its manifest. Does NOT release it — see `promote`. */
export async function publishFirmware(
  version: string,
  binary: Buffer,
  meta: { notes: string; gitSha?: string; builtAt?: string },
): Promise<FirmwareManifest> {
  if (!isFirmwareVersion(version)) throw new Error(`bad firmware version: ${version}`)
  const manifest: FirmwareManifest = {
    version,
    sha256: createHash('sha256').update(binary).digest('hex'),
    sizeBytes: binary.length,
    notes: meta.notes,
    builtAt: meta.builtAt ?? nowIso(),
    gitSha: meta.gitSha,
  }
  const { putObject } = await import('./storage')
  await putObject(firmwareBinaryKey(version), binary)
  await putJson(firmwareManifestKey(version), manifest)
  return manifest
}

/** Point a channel at an already-published version. This is the release. */
export async function promoteFirmware(channel: FirmwareChannel, version: string): Promise<'ok' | 'unknown_version'> {
  if (!isFirmwareVersion(version)) return 'unknown_version'
  const manifest = await getFirmwareManifest(version)
  const binary = await getObject(firmwareBinaryKey(version))
  // Refuse to promote a version whose bytes aren't there. A channel pointing at
  // a missing image would turn every device's next sync into a failed download.
  if (!manifest || !binary) return 'unknown_version'
  await putJson(firmwareChannelKey(channel), { version, promotedAt: nowIso() })
  channelCache.delete(channel)
  return 'ok'
}

export async function getFirmwareManifest(version: string): Promise<FirmwareManifest | null> {
  if (!isFirmwareVersion(version)) return null
  return getJson<FirmwareManifest>(firmwareManifestKey(version))
}

/** Every published version, newest-numbered first. For the admin route + scripts. */
export async function listPublishedVersions(): Promise<string[]> {
  const keys = await listKeys('firmware/')
  const versions = keys
    .map(k => /^firmware\/([^/]+)\/manifest\.json$/.exec(k)?.[1])
    .filter((v): v is string => isFirmwareVersion(v))
  return versions.sort(compareVersionsDesc)
}

/** Descending semver-ish sort. A pre-release sorts below the same release. */
export function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2)
    const nums = core.split('.').map(Number)
    return { nums, pre: pre ?? '' }
  }
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if ((pb.nums[i] ?? 0) !== (pa.nums[i] ?? 0)) return (pb.nums[i] ?? 0) - (pa.nums[i] ?? 0)
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return -1   // a release outranks its own pre-release
  if (!pb.pre) return 1
  return pb.pre.localeCompare(pa.pre)
}

// ---------------------------------------------------------------------------
// What a device is offered
// ---------------------------------------------------------------------------

export type FirmwareOffer =
  | { status: 'up_to_date'; version: string | null }
  | { status: 'no_channel' }
  | { status: 'missing_manifest'; version: string }
  | { status: 'update'; manifest: FirmwareManifest; url: string; expiresInSeconds: number }

/**
 * Decide what to serve a device reporting `current`.
 *
 * `up_to_date` is by far the common case and costs one cached channel read —
 * no manifest fetch, no presign. The presigned URL is generated per request on
 * purpose: issuance is the thing we record, so a URL must not be shared between
 * devices.
 */
export async function firmwareOfferFor(
  current: string | null,
  opts: { channel?: FirmwareChannel; origin?: string } = {},
): Promise<FirmwareOffer> {
  const channelVersion = await getChannelVersion(opts.channel ?? 'stable')
  if (!channelVersion) return { status: 'no_channel' }
  if (current === channelVersion) return { status: 'up_to_date', version: channelVersion }

  const manifest = await getFirmwareManifest(channelVersion)
  // A channel pointing at a version with no manifest is a release mistake, not a
  // device problem. Say so distinctly rather than serving a broken 200.
  if (!manifest) return { status: 'missing_manifest', version: channelVersion }

  const url = await presignGetUrl(firmwareBinaryKey(channelVersion), DOWNLOAD_URL_TTL_SECONDS, opts.origin)
  return { status: 'update', manifest, url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS }
}

// ---------------------------------------------------------------------------
// Records (1.4 / 1.5)
// ---------------------------------------------------------------------------

export async function recordFirmwareOffered(
  deviceId: string, version: string, rec: FirmwareOfferedRecord,
): Promise<void> {
  if (!isFirmwareVersion(version)) return
  await putJson(offeredKey(deviceId, version), rec)
}

/**
 * Record a boot outcome. Idempotent on (deviceId, version): a device that retries
 * its ack — which it will, since the ack rides on a sync that may fail — must not
 * create a second record or a second metric.
 *
 * Returns whether this was the first ack, so the caller knows whether to emit.
 */
export async function recordFirmwareBooted(
  deviceId: string, version: string, rec: FirmwareBootedRecord,
): Promise<'recorded' | 'duplicate'> {
  if (!isFirmwareVersion(version)) return 'duplicate'
  const existing = await getJson<FirmwareBootedRecord>(bootedKey(deviceId, version))
  if (existing) return 'duplicate'
  await putJson(bootedKey(deviceId, version), rec)
  return 'recorded'
}

export type FirmwareEventRow = {
  version: string
  offered: FirmwareOfferedRecord | null
  booted: FirmwareBootedRecord | null
}

/** One device's firmware history, newest version first. Admin route only. */
export async function listDeviceFirmwareEvents(deviceId: string): Promise<FirmwareEventRow[]> {
  const keys = await listKeys(`firmware-events/${deviceId}/`)
  const versions = [...new Set(
    keys.map(k => new RegExp(`^firmware-events/${deviceId}/([^/]+)/`).exec(k)?.[1])
      .filter((v): v is string => isFirmwareVersion(v)),
  )].sort(compareVersionsDesc)
  return Promise.all(versions.map(async version => ({
    version,
    offered: await getJson<FirmwareOfferedRecord>(offeredKey(deviceId, version)),
    booted: await getJson<FirmwareBootedRecord>(bootedKey(deviceId, version)),
  })))
}
