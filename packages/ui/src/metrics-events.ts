// Shared analytics event vocabulary — the single source of truth for the STRICT
// allowlist. Pure (no React/DOM), so it's safe to import from the client capture
// (./analytics), the att server route + EMF helpers (apps/web/src/lib/metrics.ts
// re-exports these), and both apps. To add an event, add its name here, then
// call capture('your_event') anywhere in client code.
export type MetricEvent =
  | 'pageview'
  | 'signup'
  | 'login'
  | 'upload'
  | 'trial_create'
  | 'course_create'
  | 'campaign_cta'     // a campaign landing's main button (e.g. CLICK TO SNITCH)
  | 'campaign_signup'  // server: an application from a campaign landing was saved

export const METRIC_EVENTS: readonly MetricEvent[] = [
  'pageview', 'signup', 'login', 'upload', 'trial_create', 'course_create',
  'campaign_cta', 'campaign_signup',
]

export function isMetricEvent(v: unknown): v is MetricEvent {
  return typeof v === 'string' && (METRIC_EVENTS as readonly string[]).includes(v)
}

// Which campaign link a page view came from: the `?campaign=` id, lower-cased,
// or undefined. Unknown ids are kept (a mistyped link is worth seeing on the
// dashboard); anything that isn't a short plain id is dropped so the logs never
// carry junk someone typed into the URL.
export function campaignFrom(search: string): string | undefined {
  const id = new URLSearchParams(search).get('campaign')?.trim().toLowerCase()
  return id && /^[a-z0-9_-]{1,40}$/.test(id) ? id : undefined
}
