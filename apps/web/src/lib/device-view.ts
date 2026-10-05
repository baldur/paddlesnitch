// Presentation helpers for the My Devices pages. Pure — no fetch, no React — so
// the grouping rule that decides what a device card says is unit-tested rather
// than eyeballed in the browser.
import type { DeviceSessionMeta } from '@/lib/devices'

export const fmtDate = (iso?: string) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(0, 16) }
}
export const fmtDay = (iso?: string) => {
  if (!iso) return 'never'
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return iso.slice(0, 10) }
}
export const fmtDist = (m?: number) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)
export const fmtDur = (s?: number | null) => {
  if (s == null) return '—'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return m ? `${m}m ${sec}s` : `${sec}s`
}

/** What the client needs about a linked tracker. Deliberately NOT `DeviceRecord`:
 *  that type carries `tokenHash`, which has no business in a browser bundle. */
export type DeviceView = {
  deviceId: string; name: string; model?: string; firmware?: string
  linkedAt?: string; lastSeenAt?: string
  /** The tracker's most recent crash, as it reported on its next start. */
  lastCrash?: { at: string; task: string }
}

/** How long a crash stays on the tracker's card. */
export const CRASH_SHOWN_MS = 7 * 24 * 60 * 60 * 1000

/** "crashed 2h ago (uplink)" for a crash in the last week, else null. */
export function crashNote(c: { at: string; task: string } | undefined, now: number = Date.now()): string | null {
  if (!c) return null
  const t = Date.parse(c.at)
  if (!Number.isFinite(t) || now - t > CRASH_SHOWN_MS) return null
  return `crashed ${fmtAgo(c.at, now)}${c.task ? ` (${c.task})` : ''}`
}

/** How long without a word before a tracker is worth flagging. Two days: a
 *  device syncs every 5 minutes when it is powered and on a known network, so
 *  silence this long means it is off, away, or stuck — all worth noticing. */
export const DEVICE_QUIET_MS = 2 * 24 * 60 * 60 * 1000

export function deviceIsQuiet(lastSeenAt?: string, now: number = Date.now()): boolean {
  if (!lastSeenAt) return true
  const t = Date.parse(lastSeenAt)
  return !Number.isFinite(t) || now - t > DEVICE_QUIET_MS
}

/** Is this device behind the released firmware? Null when either side is
 *  unknown — an unknown answer must not render as "up to date". */
export function deviceIsBehind(firmware?: string, stableVersion?: string | null): boolean | null {
  if (!firmware || !stableVersion) return null
  return firmware !== stableVersion
}

/** "3 minutes ago" / "2 days ago". Short, because it sits in a dense row. */
export function fmtAgo(iso?: string, now: number = Date.now()): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'never'
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 90) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 90) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export type DeviceSummary = DeviceView & {
  /** false = the device record is gone (revoked) but its uploads are still ours.
   *  Sessions outlive the binding, so dropping them from the page would hide
   *  data the user can still open. */
  linked: boolean
  sessions: number
  motionSessions: number
  totalDistanceM: number
  /** Newest session's own start time, falling back to when it was uploaded. */
  latestAt?: string
}

const sessionAt = (s: DeviceSessionMeta) => s.startedAt ?? s.uploadedAt

/**
 * One row per device the viewer has anything for — linked trackers first (even
 * with no uploads yet, so a freshly paired device is visibly there), then any
 * device that only exists as history.
 */
export function deviceSummaries(devices: DeviceView[], sessions: DeviceSessionMeta[]): DeviceSummary[] {
  const byId = new Map<string, DeviceSummary>()
  for (const d of devices) {
    byId.set(d.deviceId, { ...d, linked: true, sessions: 0, motionSessions: 0, totalDistanceM: 0 })
  }
  for (const s of sessions) {
    let row = byId.get(s.deviceId)
    if (!row) {
      row = { deviceId: s.deviceId, name: `Tracker ${s.deviceId}`, linked: false, sessions: 0, motionSessions: 0, totalDistanceM: 0 }
      byId.set(s.deviceId, row)
    }
    row.sessions++
    if (s.motion) row.motionSessions++
    row.totalDistanceM += s.distanceMetres ?? 0
    const at = sessionAt(s)
    if (at && (!row.latestAt || at > row.latestAt)) row.latestAt = at
  }
  return [...byId.values()].sort((a, b) => {
    if (a.linked !== b.linked) return a.linked ? -1 : 1
    const ax = a.latestAt ?? a.lastSeenAt ?? ''
    const bx = b.latestAt ?? b.lastSeenAt ?? ''
    return bx > ax ? 1 : bx < ax ? -1 : a.deviceId.localeCompare(b.deviceId)
  })
}
