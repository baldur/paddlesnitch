// The performance check (scripts/perf.ts, .github/workflows/perf.yml): time the
// public pages a few times each and report, always. Pure parts here, tested.
//
// What it measures: time to first byte (TTFB: the server's work plus the trip)
// and the whole response, per page, as the median of several runs. The first
// run is reported separately: it may land on a cold Lambda, and a cold start
// is a different question from "is this page slow".
//
// Budgets are warnings, not failures: the check always finishes and reports.
// `--strict` makes a breached budget fail the run, for when that's wanted.

export type Sample = { status: number; ttfbMs: number; totalMs: number; bytes: number }

export type PageResult = {
  name: string
  path: string
  status: number
  firstTtfbMs: number          // the first run (may be a cold start)
  medianTtfbMs: number         // the median of the runs after the first
  p95TtfbMs: number
  medianTotalMs: number
  bytes: number
  budgetMs: number
  overBudget: boolean
}

export type Check = { name: string; ok: boolean; detail: string }

/** The p-th percentile (0–100) by nearest rank. Empty → NaN. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * s.length)
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))]
}

/** One page's samples → its result. The first sample is kept apart (cold start). */
export function summarise(name: string, path: string, samples: Sample[], budgetMs: number): PageResult {
  const warm = samples.length > 1 ? samples.slice(1) : samples
  const ttfb = warm.map(s => s.ttfbMs)
  const medianTtfbMs = Math.round(percentile(ttfb, 50))
  return {
    name, path,
    status: samples.find(s => s.status !== 200)?.status ?? samples[0]?.status ?? 0,
    firstTtfbMs: Math.round(samples[0]?.ttfbMs ?? NaN),
    medianTtfbMs,
    p95TtfbMs: Math.round(percentile(ttfb, 95)),
    medianTotalMs: Math.round(percentile(warm.map(s => s.totalMs), 50)),
    bytes: samples[samples.length - 1]?.bytes ?? 0,
    budgetMs,
    overBudget: medianTtfbMs > budgetMs,
  }
}

/** A built file must say "keep it for a year" (asset-caching.test.ts covers the config). */
export function checkImmutable(cacheControl: string | null): Check {
  const ok = !!cacheControl && /max-age=31536000/.test(cacheControl) && /immutable/.test(cacheControl)
  return { name: 'Built files cached for a year', ok, detail: cacheControl ?? '(no Cache-Control)' }
}

/** The report, as Markdown: the GitHub job summary and the terminal both show it. */
export function markdown(results: PageResult[], checks: Check[], meta: { baseUrl: string; runs: number; at: string }): string {
  const L: string[] = []
  L.push(`## Performance: ${meta.baseUrl}`)
  L.push('')
  L.push(`${meta.at} · ${meta.runs} runs per page · TTFB = time to first byte (median of the runs after the first)`)
  L.push('')
  L.push('| Page | Status | TTFB | p95 | First run | Whole page | Size | Budget |')
  L.push('|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    L.push(`| ${r.name} (\`${r.path}\`) | ${r.status} | **${r.medianTtfbMs} ms** | ${r.p95TtfbMs} ms | ${r.firstTtfbMs} ms | ${r.medianTotalMs} ms | ${(r.bytes / 1024).toFixed(1)} KB | ${r.overBudget ? `⚠ over ${r.budgetMs} ms` : `ok (${r.budgetMs} ms)`} |`)
  }
  if (checks.length) {
    L.push('')
    for (const c of checks) L.push(`- ${c.ok ? '✓' : '⚠'} ${c.name}: \`${c.detail}\``)
  }
  const over = results.filter(r => r.overBudget || r.status !== 200)
  L.push('')
  L.push(over.length ? `**${over.length} page${over.length === 1 ? '' : 's'} over budget or not 200:** ${over.map(r => r.name).join(', ')}` : 'All pages within budget.')
  return L.join('\n')
}

/**
 * The CloudWatch metric data for `aws cloudwatch put-metric-data
 * --cli-input-json`: one TTFB value per page (namespace Paddlesnitch/Perf,
 * dimension Page). One metric per page on purpose: each custom metric costs
 * about $0.30 a month.
 */
export function metricData(results: PageResult[], at: Date) {
  return {
    Namespace: 'Paddlesnitch/Perf',
    MetricData: results.filter(r => Number.isFinite(r.medianTtfbMs)).map(r => ({
      MetricName: 'TTFB',
      Dimensions: [{ Name: 'Page', Value: r.name }],
      Timestamp: at.toISOString(),
      Value: r.medianTtfbMs,
      Unit: 'Milliseconds',
    })),
  }
}
