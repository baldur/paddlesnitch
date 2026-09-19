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
