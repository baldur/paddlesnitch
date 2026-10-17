// Source health (docs/features/waterways-uk-ireland.md, "Staging and health"):
// each weekly run fetches every source afresh. A source that fails, or comes
// back with far fewer features than last time, doesn't silently drop out of
// the published data: the last good copy, staged in S3, is used instead and
// the source is marked stale. Three stale runs in a row opens an issue. Pure:
// scripts/waterways/fetch-sources.ts does the fetching and the storage.

export type SourceHealth = {
  status: 'ok' | 'stale' | 'missing'
  features: number               // in the copy being used
  lastOk?: string                // ISO, when a fresh copy was last accepted
  failures: number               // runs in a row without a fresh copy
  error?: string
}

export type HealthFile = { checkedAt: string; sources: Record<string, SourceHealth> }

export const HEALTH_KEY = 'waterways/health.json'
export const stagedKey = (source: string) => `waterways/normalised/${source}.json.gz`

/** A fresh copy with less than this share of the last good one's features is
 *  treated as a failure: a changed API more often returns nothing than errors. */
export const SHRINK = 0.5

/** Runs in a row without a fresh copy before someone is asked to look. */
export const FAILING_RUNS = 3

/** Whether to use this run's copy, the staged one, or neither, and the
 *  source's health afterwards. */
export function assess(
  fresh: { features: number } | { error: string },
  prev: SourceHealth | undefined,
  staged: number | null,         // features in the staged copy, if there is one
  now: string,
): { use: 'fresh' | 'staged' | 'none'; health: SourceHealth } {
  let error = 'error' in fresh ? fresh.error : undefined
  if (!error && 'features' in fresh && fresh.features === 0) error = 'no features'
  if (!error && 'features' in fresh && prev && prev.features > 0 && fresh.features < prev.features * SHRINK) {
    error = `only ${fresh.features} features; the last good copy had ${prev.features}`
  }
  if (!error && 'features' in fresh) return { use: 'fresh', health: { status: 'ok', features: fresh.features, lastOk: now, failures: 0 } }
  const failures = (prev?.failures ?? 0) + 1
  if (staged) return { use: 'staged', health: { status: 'stale', features: staged, lastOk: prev?.lastOk, failures, error } }
  return { use: 'none', health: { status: 'missing', features: 0, lastOk: prev?.lastOk, failures, error } }
}

/** Sources that have gone FAILING_RUNS runs without a fresh copy. */
export const failing = (h: HealthFile) =>
  Object.entries(h.sources).filter(([, s]) => s.failures >= FAILING_RUNS).map(([name]) => name)

/** One line per source for the run log and the data PR. */
export function healthLines(h: HealthFile): string[] {
  return Object.entries(h.sources).map(([name, s]) =>
    s.status === 'ok' ? `${name}: ok, ${s.features} features`
      : `${name}: ${s.status.toUpperCase()}${s.status === 'stale' ? `, using the copy from ${s.lastOk?.slice(0, 10) ?? '?'} (${s.features} features)` : ''}; ${s.failures} run(s) failing: ${s.error}`)
}
