// Shared analytics event vocabulary — the single source of truth for the STRICT
// allowlist. Pure (no React/DOM), so it's safe to import from the client capture
// (./analytics), the att server route + EMF helpers (apps/att/src/lib/metrics.ts
// re-exports these), and both apps. To add an event, add its name here, then
// call capture('your_event') anywhere in client code.
export type MetricEvent =
  | 'pageview'
  | 'signup'
  | 'login'
  | 'upload'
  | 'trial_create'
  | 'course_create'

export const METRIC_EVENTS: readonly MetricEvent[] = [
  'pageview', 'signup', 'login', 'upload', 'trial_create', 'course_create',
]

export function isMetricEvent(v: unknown): v is MetricEvent {
  return typeof v === 'string' && (METRIC_EVENTS as readonly string[]).includes(v)
}
