'use client'
// Client-side event capture with buffering + periodic flush. SHARED by both apps
// (att + analyse) — the pageview beacon and any capture() call in either app
// funnels through here to the shared-origin ingest endpoint.
//
// `capture(event, props?)` appends to an in-memory queue instead of firing a
// request per event. The queue is flushed to POST /att/api/track as a BATCH
// ({ sid, events: [...] }) on whichever comes first:
//   - a timer (flushIntervalMs),
//   - the queue reaching maxBatch,
//   - the tab being hidden/closed (visibilitychange→hidden / pagehide), via
//     navigator.sendBeacon so the request survives the unload.
//
// The endpoint is an absolute path, so it reaches the att server from BOTH apps
// across the shared CloudFront origin (fetch/sendBeacon ignore Next basePath).
//
// Vocabulary is a STRICT allowlist (./metrics-events): only allowlisted names
// are captured — anything else is dropped at the door (and again server-side),
// so no arbitrary event can create a metric.
//
// No PII: the only identifier sent is a random per-tab session id.
import { isMetricEvent, type MetricEvent } from './metrics-events'

// Config + gate. `enabled` is prod-only with a NEXT_PUBLIC_ANALYTICS=0 kill
// switch; it's a mutable object (not a bare const) so tests can flip it on
// without faking the build env. Tune cadence/caps here.
export const _config = {
  enabled: process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_ANALYTICS !== '0',
  endpoint: '/att/api/track',
  flushIntervalMs: 15_000,
  maxBatch: 20,   // flush once the queue reaches this many events
  maxQueue: 100,  // hard cap: if flushes keep failing, drop the oldest beyond this
}

type Queued = { event: MetricEvent; t: number; props?: Record<string, string> }

let queue: Queued[] = []
let timer: ReturnType<typeof setInterval> | null = null
let bound = false

function sessionId(): string {
  try {
    const KEY = 'tt_sid'
    let sid = sessionStorage.getItem(KEY)
    if (!sid) {
      sid = (crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 32)
      sessionStorage.setItem(KEY, sid)
    }
    return sid
  } catch {
    return 'anon'
  }
}

// Queue an event. No-op when disabled or when the name isn't allowlisted.
export function capture(event: string, props?: Record<string, string>): void {
  if (!_config.enabled) return
  if (!isMetricEvent(event)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[analytics] dropped non-allowlisted event: ${String(event)}`)
    }
    return
  }
  queue.push({ event, t: Date.now(), props })
  if (queue.length > _config.maxQueue) queue = queue.slice(-_config.maxQueue)
  if (queue.length >= _config.maxBatch) flush()
}

// Send the buffered events as one batch. `useBeacon` uses sendBeacon (for the
// unload path); otherwise a keepalive fetch. On a transport failure the events
// are put back so the next flush retries them.
export function flush(useBeacon = false): void {
  if (!queue.length) return
  const events = queue
  queue = []
  const payload = JSON.stringify({ sid: sessionId(), events })
  try {
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(_config.endpoint, new Blob([payload], { type: 'application/json' }))
      if (!ok) queue = events.concat(queue)
      return
    }
    fetch(_config.endpoint, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => { queue = events.concat(queue) })
  } catch {
    queue = events.concat(queue)
  }
}

// Browser errors from our own scripts (docs/features/observability.md). At
// most MAX_ERRORS per page load, each message once. Errors from extensions and
// other sites' scripts aren't ours, so they never leave the browser: the
// zero-tolerance alarm only hears about our code.
const MAX_ERRORS = 5
let errorsSent = 0
const errorsSeen = new Set<string>()

/** True when `source` (a script URL or a stack trace) points at our origin. */
export function isOwnScript(source: string | undefined, origin: string): boolean {
  return !!source && source.includes(`${origin}/`)
}

/** Report one browser error: its type and the first line of its message. */
export function reportClientError(type: string, message: string): void {
  if (!_config.enabled) return
  const first = (message ?? '').split('\n')[0].trim().slice(0, 120)
  // "Script error." is the browser hiding another origin's error from us.
  if (!first || first === 'Script error.' || errorsSent >= MAX_ERRORS || errorsSeen.has(first)) return
  errorsSeen.add(first)
  errorsSent++
  capture('client_error', { type: (type || 'Error').slice(0, 60), message: first, path: window.location.pathname })
}

// Start the flush timer + unload listeners. Idempotent; safe to call on mount.
export function startAnalytics(): void {
  if (!_config.enabled || bound) return
  bound = true
  timer = setInterval(() => flush(false), _config.flushIntervalMs)
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(true) }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', () => flush(true))
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
}

function onError(e: ErrorEvent) {
  // Resource load errors (a broken image) carry no filename and are dropped.
  if (!isOwnScript(e.filename, window.location.origin)) return
  reportClientError(e.error?.name ?? 'Error', e.message)
}

function onRejection(e: PromiseRejectionEvent) {
  const r = e.reason
  if (!(r instanceof Error) || !isOwnScript(r.stack, window.location.origin)) return
  reportClientError(r.name, r.message)
}

// Test-only: reset module state between cases.
export function _resetForTest(): void {
  queue = []
  if (timer) clearInterval(timer)
  timer = null
  bound = false
  errorsSent = 0
  errorsSeen.clear()
  if (typeof window !== 'undefined') {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
