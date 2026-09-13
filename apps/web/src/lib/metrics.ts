// Product analytics via CloudWatch Embedded Metric Format (EMF).
//
// We emit one specially-shaped JSON line per event. In the Lambda runtime,
// CloudWatch automatically extracts a `Count` metric (dimension: Event) from
// these lines — no metric filters, no log-parsing pipeline, no extra IAM (the
// function already writes to CloudWatch Logs). Locally / in tests it just prints
// JSON, which is a harmless no-op for metrics.
//
// Cardinality discipline: the ONLY metric dimension is `Event` (a small fixed
// allowlist), so metric cost stays bounded. High-cardinality context like the
// page path is attached as a plain property — queryable in CloudWatch Logs
// Insights, but it does NOT create per-path metrics.

// The event vocabulary (strict allowlist) is shared platform state in
// @paddlesnitch/ui/metrics-events (single source of truth for client capture +
// this server EMF path). Re-exported here so existing `@/lib/metrics` importers
// (the track route, tests) keep resolving unchanged.
export { METRIC_EVENTS, isMetricEvent } from '@paddlesnitch/ui/metrics-events'
export type { MetricEvent } from '@paddlesnitch/ui/metrics-events'
import type { MetricEvent } from '@paddlesnitch/ui/metrics-events'

export const NAMESPACE = 'Paddlesnitch/App'

// Build the EMF document for an event (exported for testing). `timestamp` is the
// metric time in epoch ms — defaults to now, but batched client events pass their
// own capture time so the metric lands in the right minute, not at flush time.
export function buildEmf(event: MetricEvent, props: Record<string, string> = {}, timestamp: number = Date.now()) {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{
        Namespace: NAMESPACE,
        Dimensions: [['Event']],
        Metrics: [{ Name: 'Count', Unit: 'Count' }],
      }],
    },
    Event: event,
    Count: 1,
    ...props,
  }
}

// Emit a single event. Never throws — analytics must never break a request.
export function emitMetric(event: MetricEvent, props: Record<string, string> = {}, timestamp?: number): void {
  try {
    console.log(JSON.stringify(buildEmf(event, props, timestamp)))
  } catch {
    // swallow — a metric emission failure must not surface to the caller
  }
}
