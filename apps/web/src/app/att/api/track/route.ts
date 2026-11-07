import { NextRequest, NextResponse } from 'next/server'
import { emitMetric, clientEventProps, eventPath, isMetricEvent, type MetricEvent } from '@/lib/metrics'
import { SERVER_ONLY_EVENTS, VISIT_SOURCE_PROPS } from '@paddlesnitch/ui/metrics-events'
import { visitorLocation, type VisitorLocation } from '@/lib/visitor-location'
import { isAllowedIngestOrigin } from '@/lib/ingest-origin'
import { clientOf, type Client } from '@paddlesnitch/core/observe'
import { crashReportProps, clientErrorProps } from '@/lib/client-errors'

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
//
// The Android and iPhone apps send no Origin, so a request with a well-formed
// `x-paddlesnitch-app` app header is accepted instead. That header is as
// spoofable as Origin; the allowlist and the caps are what bound abuse. Every
// event gets `platform` (and the app's version) from the request, never from
// the client's props (docs/features/observability.md).
//
// Where visitors come from (#906): every page view gets `country` (and for the
// UK, `nation`) from CloudFront's headers (lib/visitor-location.ts), never from
// the body. A tab's first page view (`visit: '1'`) also writes one `visit`
// record with only the country, city and where the visit came from (`ref`, utm
// tags): no tab id, path, nation or platform. In the server logs (90 days) it
// sits next to the page view that caused it, so they can be joined there; the
// long-term archive keeps no visit rows, only daily counts with anything seen
// fewer than 5 times grouped as "other" (infra/lambdas/visit-counts).
// The page view itself keeps none of the visit's props. Plain properties only:
// `Event` stays the one metric dimension.

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

// A random per-tab or per-app-start id: letters, digits, dots and hyphens
// only (a UUID, Math.random digits, 'anon'), never free text.
const sidOf = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : undefined

// Set by the server, never taken from a client's props.
const RESERVED = new Set(['sid', 'path', 'platform', 'appVersion', 'build', 'country', 'nation', 'city'])

function clientProps(c: Client): Record<string, string> {
  return { platform: c.platform, ...(c.version ? { appVersion: c.version } : {}), ...(c.build ? { build: c.build } : {}) }
}

function buildProps(sid: string | undefined, path: unknown, props: unknown, client: Client): Record<string, string> {
  const out: Record<string, string> = {}
  if (sid) out.sid = sid
  const p = str(path, STR)
  if (p) out.path = p
  if (props && typeof props === 'object') {
    let n = 0
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (n >= MAX_PROPS) break
      if (RESERVED.has(k)) continue
      const val = str(v, STR)
      if (val !== undefined) { out[k.slice(0, 40)] = val; n++ }
    }
  }
  return { ...out, ...clientProps(client) }
}

// The two error reports have fixed fields (lib/client-errors.ts); a malformed
// one is dropped rather than counted.
function propsFor(event: MetricEvent, sid: string | undefined, path: unknown, props: unknown, client: Client, where: VisitorLocation): Record<string, string> | null {
  if (event === 'crash_report') {
    const crash = crashReportProps(props)
    return crash && { ...(sid ? { sid } : {}), ...crash, ...clientProps(client) }
  }
  if (event === 'client_error') {
    const err = clientErrorProps(props, path)
    return err && { ...(sid ? { sid } : {}), ...err, ...clientProps(client) }
  }
  const own = clientEventProps(event, props)
  if (event === 'pageview') {
    delete own.visit
    for (const k of VISIT_SOURCE_PROPS) delete own[k]
    return { ...buildProps(sid, eventPath(event, path), own, client), ...place(where.country, where.nation) }
  }
  return buildProps(sid, eventPath(event, path), own, client)
}

const place = (country?: string, nation?: string): Record<string, string> =>
  ({ ...(country ? { country } : {}), ...(nation ? { nation } : {}) })

/** The visit record for a tab's first page view, or null: country, city and
 *  source only. No sid, path, nation or platform. */
function visitProps(event: MetricEvent, props: unknown, where: VisitorLocation): Record<string, string> | null {
  if (event !== 'pageview') return null
  const own = clientEventProps(event, props)
  if (own.visit !== '1') return null
  const source = Object.fromEntries(VISIT_SOURCE_PROPS.flatMap(k => own[k] ? [[k, own[k]]] : []))
  return { ...place(where.country), ...(where.city ? { city: where.city } : {}), ...source }
}

export async function POST(req: NextRequest) {
  // Drop beacons that don't carry our own origin (cheap first line against
  // random/bot pings — spoofable, see ingest-origin.ts). Still 204 so a bot
  // gets no signal it was rejected.
  const client = clientOf(req.headers)
  const isApp = client.platform === 'android' || client.platform === 'ios'
  if (!isApp && !isAllowedIngestOrigin(req)) return new NextResponse(null, { status: 204 })

  const body = await req.json().catch(() => ({}))
  const where = visitorLocation(req.headers)
  // One visit record a request at most, however many page views say first.
  let visited = false
  const emitVisit = (event: MetricEvent, props: unknown) => {
    if (visited) return
    const v = visitProps(event, props, where)
    if (v) { visited = true; emitMetric('visit', v) }
  }

  // Batch shape.
  if (Array.isArray(body?.events)) {
    const sid = sidOf(body.sid)
    for (const e of body.events.slice(0, MAX_EVENTS)) {
      if (!isMetricEvent(e?.event) || SERVER_ONLY_EVENTS.has(e.event)) continue // strict allowlist
      const props = propsFor(e.event, sid, e?.path ?? (e?.props as Record<string, unknown>)?.path, e?.props, client, where)
      if (props) emitMetric(e.event, props, safeTs(e?.t))
      emitVisit(e.event, e?.props)
    }
    return new NextResponse(null, { status: 204 })
  }

  // Single-event back-compat shape.
  if (isMetricEvent(body?.event) && !SERVER_ONLY_EVENTS.has(body.event)) {
    const props = propsFor(body.event, sidOf(body.sid), body.path, undefined, client, where)
    if (props) emitMetric(body.event, props)
  }
  return new NextResponse(null, { status: 204 })
}
