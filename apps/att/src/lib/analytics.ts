'use client'
// Client-side event capture with buffering + periodic flush.
//
// `capture(event, props?)` appends to an in-memory queue instead of firing a
// request per event. The queue is flushed to POST /att/api/track as a BATCH
// ({ sid, events: [...] }) on whichever comes first:
//   - a timer (flushIntervalMs),
//   - the queue reaching maxBatch,
//   - the tab being hidden/closed (visibilitychange→hidden / pagehide), via
//     navigator.sendBeacon so the request survives the unload.
//
// Vocabulary is a STRICT allowlist: only names in METRIC_EVENTS (see metrics.ts)
// are captured — anything else is dropped at the door (and again server-side),
// so no arbitrary event can create a metric. To add an event, add it to
// METRIC_EVENTS, then call capture('your_event') anywhere in client code.
//
// No PII: the only identifier sent is a random per-tab session id.
import { isMetricEvent, type MetricEvent } from './metrics'

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

// Start the flush timer + unload listeners. Idempotent; safe to call on mount.
export function startAnalytics(): void {
  if (!_config.enabled || bound) return
  bound = true
  timer = setInterval(() => flush(false), _config.flushIntervalMs)
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(true) }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', () => flush(true))
}

// Test-only: reset module state between cases.
export function _resetForTest(): void {
  queue = []
  if (timer) clearInterval(timer)
  timer = null
  bound = false
}
