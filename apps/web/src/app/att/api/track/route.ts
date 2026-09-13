import { NextRequest, NextResponse } from 'next/server'
import { emitMetric, isMetricEvent } from '@/lib/metrics'
import { isAllowedIngestOrigin } from '@/lib/ingest-origin'

// Receives client-side analytics beacons and emits CloudWatch EMF events.
// Unauthenticated by design — events come from anyone. No PII is recorded: only
// the event name, the path, a client-generated random session id (not tied to
// identity), and any small string props the client attached. Non-allowlisted
// events are dropped so arbitrary input can't create new metrics.
//
// Two accepted shapes:
//   - BATCH  (current client): { sid, events: [{ event, t?, path?, props? }] }
//   - SINGLE (back-compat):     { event, path?, sid? }
//
// Always returns 204 (No Content) — beacons are fire-and-forget; the client
// neither needs nor reads a body.

const MAX_EVENTS = 100   // cap events per batch (abuse guard)
const MAX_PROPS = 10     // cap custom props per event
const STR = 200          // max length of any prop value / path
const SID = 64           // max length of the session id

const str = (v: unknown, n: number): string | undefined =>
  typeof v === 'string' ? v.slice(0, n) : undefined

// CloudWatch rejects EMF timestamps older than 2 weeks or >2h in the future;
// fall back to now (undefined → emitMetric uses Date.now()) if out of range.
function safeTs(t: unknown): number | undefined {
  if (typeof t !== 'number' || !Number.isFinite(t)) return undefined
  const now = Date.now()
  if (t < now - 14 * 24 * 3600_000 || t > now + 2 * 3600_000) return undefined
  return t
}

function buildProps(sid: string | undefined, path: unknown, props: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (sid) out.sid = sid
  const p = str(path, STR)
  if (p) out.path = p
  if (props && typeof props === 'object') {
    let n = 0
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (n >= MAX_PROPS) break
      if (k === 'sid' || k === 'path') continue // reserved, set above
      const val = str(v, STR)
      if (val !== undefined) { out[k.slice(0, 40)] = val; n++ }
    }
  }
  return out
}

export async function POST(req: NextRequest) {
  // Drop beacons that don't carry our own origin (cheap first line against
  // random/bot pings — spoofable, see ingest-origin.ts). Still 204 so a bot
  // gets no signal it was rejected.
  if (!isAllowedIngestOrigin(req)) return new NextResponse(null, { status: 204 })

  const body = await req.json().catch(() => ({}))

  // Batch shape.
  if (Array.isArray(body?.events)) {
    const sid = str(body.sid, SID)
    for (const e of body.events.slice(0, MAX_EVENTS)) {
      if (!isMetricEvent(e?.event)) continue // strict allowlist
      emitMetric(e.event, buildProps(sid, e?.path ?? (e?.props as Record<string, unknown>)?.path, e?.props), safeTs(e?.t))
    }
    return new NextResponse(null, { status: 204 })
  }

  // Single-event back-compat shape.
  if (isMetricEvent(body?.event)) {
    emitMetric(body.event, buildProps(str(body.sid, SID), body.path, undefined))
  }
  return new NextResponse(null, { status: 204 })
}
