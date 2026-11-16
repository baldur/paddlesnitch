import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'crypto'

// The accessibility + console sweep (docs/night-shift/jobs/sweep.md).
//
// It MEASURES, it doesn't assert on findings: for every page, signed out and
// signed in, it records axe violations (every impact, wcag2a/wcag2aa/
// best-practice), console errors and warnings, pageerrors, and responses >= 400.
// The spec fails ONLY when a page does not load, so a finding is a number, never
// a red test.
//
// Metric sweep-problems = axe violations (counted by node) + console errors +
// responses >= 400, per page, summed. Lower is better.
//
// Robustness: each page's result is written to its own file the moment it is
// measured (a stop mid-sweep keeps what's done), and a final pass aggregates the
// per-page files into a summary. Nothing depends on module state surviving
// across tests.
//
// Two things the harness itself produces, flagged (not dropped) so the product
// number stays honest:
//   - `noise`: dev-only console chatter (Fast Refresh, React DevTools, …).
//   - `overlay`: the Next.js dev error overlay, shown when a page throws. A page
//     that hit the overlay is recorded with overlay:true and its error text; axe
//     is not run on a crashed page (the count would be meaningless).

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const PAGES = [
  '/',
  '/plan?from=51.399410,-1.347414&to=51.400405,-1.134311',
  '/plan/gaps',
  '/plan/portage/crt%3Alocks%3AKA-013-009',
  '/att',
  '/paddles',
  '/help',
  '/signin',
  '/terms',
  // added by the job:
  '/analyse/library',
  '/profile/me',
  '/profile/me/settings',
  '/profile/me/devices',
  '/games',
]

const NOISE = [
  /Fast Refresh/i,
  /React DevTools/i,
  /development build of Next\.js/i,
  /webpack compiled/i,
  /Download the React/i,
  /browserslist/i,
  /\bhot\s*reloading\b/i,
]
function noisy(text: string): boolean {
  return NOISE.some(re => re.test(text))
}

// Where the confirmation code a sign-up produced. cognito-local stores it on disk
// in the run's own pool db; the runner points COGNITO_LOCAL_DB_DIR + COGNITO_USER_POOL_ID
// at it. Polls because the write lags the response.
async function confirmCode(email: string): Promise<string> {
  const dbDir = process.env.COGNITO_LOCAL_DB_DIR
  const pool = process.env.COGNITO_USER_POOL_ID
  if (!dbDir || !pool) throw new Error('COGNITO_LOCAL_DB_DIR / COGNITO_USER_POOL_ID not set')
  const dbFile = join(dbDir, `${pool}.json`)
  for (let i = 0; i < 60; i++) {
    try {
      const j = JSON.parse(readFileSync(dbFile, 'utf8'))
      const users = j.Users ?? {}
      for (const u of Object.values(users) as Array<{ Attributes?: Array<{ Name: string; Value: string }>; ConfirmationCode?: string }>) {
        const em = u.Attributes?.find(a => a.Name === 'email')?.Value
        if (em === email && u.ConfirmationCode) return u.ConfirmationCode
      }
    } catch { /* mid-write */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`no confirmation code for ${email} in ${dbFile}`)
}

async function signUp(page: Page, email: string, displayName = 'Sweep User'): Promise<void> {
  await page.goto('/signin')
  // Short per-step timeouts: under the night-shift's webpack dev a page that
  // crashes never shows the tab, so this fails fast and the test can record the
  // blocker instead of eating the whole budget.
  await page.getByRole('tab', { name: 'Create account', exact: true }).click({ timeout: 20_000 })
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[autocomplete="name"]').fill(displayName)
  await page.locator('input[type="password"]').fill('Password123')
  await page.getByLabel(/I have read and agree/i).check()
  await page.getByRole('button', { name: 'Create account', exact: true }).click({ timeout: 20_000 })
  await page.getByLabel('Code', { exact: true }).fill(await confirmCode(email), { timeout: 20_000 })
  await page.getByRole('button', { name: 'Confirm email', exact: true }).click({ timeout: 20_000 })
  await expect(page).toHaveURL('/paddles', { timeout: 20_000 })
}

type Finding = { id: string; impact: string | null; nodes: number; examples: string[] }
type PageResult = {
  key: string
  url: string
  state: 'signed-out' | 'signed-in'
  loaded: boolean
  loadError?: string
  overlay: boolean
  overlayError?: string
  axeViolations: Finding[]
  consoleErrors: Array<{ text: string; noise: boolean }>
  consoleWarnings: Array<{ text: string; noise: boolean }>
  pageErrors: string[]
  responses4xx: Array<{ status: number; url: string }>
}

function problemCount(p: PageResult): number {
  const axeNodes = p.axeViolations.reduce((n, v) => n + v.nodes, 0)
  return axeNodes + p.consoleErrors.length + p.responses4xx.length
}
// The product count: the raw count minus harness artifacts (dev overlay + noise
// console chatter). The raw count is kept in the JSON; this is what "fix a
// problem" should drive down.
function productCount(p: PageResult): number {
  const axeNodes = p.overlay ? 0 : p.axeViolations.reduce((n, v) => n + v.nodes, 0)
  const consoleErrors = p.consoleErrors.filter(c => !c.noise).length
  const overlay = p.overlay ? 1 : 0
  return axeNodes + consoleErrors + p.responses4xx.length + overlay
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16) // to the minute
const OUT_DIR = join(process.env.NIGHT_WORK ?? process.cwd(), 'sweep')
mkdirSync(OUT_DIR, { recursive: true })
const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60)

function writePage(p: PageResult) {
  writeFileSync(join(OUT_DIR, `${STAMP}__${p.state}__${safe(p.url)}.json`), JSON.stringify(p, null, 2))
}

async function measure(page: Page, url: string, state: 'signed-out' | 'signed-in'): Promise<PageResult> {
  const res: PageResult = {
    key: `${state} ${url}`,
    url,
    state,
    loaded: false,
    overlay: false,
    axeViolations: [],
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    responses4xx: [],
  }
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    try {
      const text = msg.text()
      if (msg.type() === 'error') res.consoleErrors.push({ text, noise: noisy(text) })
      else if (msg.type() === 'warning') res.consoleWarnings.push({ text, noise: noisy(text) })
    } catch { /* ignore */ }
  }
  const onPageError = (err: unknown) => {
    try {
      res.pageErrors.push(err instanceof Error ? err.message : String(err))
    } catch { /* ignore */ }
  }
  const onResponse = (r: { status: () => number; url: () => string }) => {
    try {
      const status = r.status()
      if (status >= 400) res.responses4xx.push({ status, url: r.url() })
    } catch { /* ignore */ }
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('response', onResponse)
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 })
    res.loaded = true
    // Is the Next.js dev error overlay showing (the page threw at runtime)? The
    // overlay mounts as #__next_error__ (older builds: #nextjs__error_overlay).
    // A crashed page renders the overlay's own markup, so axe must not score it.
    const overlayInfo = await page.evaluate(() => {
      const el = document.querySelector('#__next_error__') ?? document.querySelector('#nextjs__error_overlay')
      const text = (el ?? document.body)?.textContent ?? ''
      return { present: !!el, text: text.slice(0, 400) }
    }).catch(() => ({ present: false, text: '' }))
    if (overlayInfo.present || res.pageErrors.length > 0) {
      res.overlay = true
      res.overlayError = overlayInfo.text || res.pageErrors[0] || ''
    }
    if (!res.overlay) {
      try {
        await page.addScriptTag({ content: AXE })
        res.axeViolations = await page.evaluate(async () => {
          const r = await (window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: { target: string[] }[] }> }> } })
            .axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })
          return r.violations.map(v => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            examples: v.nodes.slice(0, 3).map(n => n.target.join(' ')),
          }))
        })
      } catch { /* axe failed to run; record what we have */ }
    }
  } catch (e) {
    res.loadError = e instanceof Error ? e.message : String(e)
  } finally {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)
    writePage(res)
  }
  return res
}

// Signed out: one fresh (unauthenticated) context per page.
for (const url of PAGES) {
  test(`sweep (signed out) ${url}`, async ({ page }) => {
    const r = await measure(page, url, 'signed-out')
    if (!r.loaded) throw new Error(`page did not load: ${r.loadError}`)
  })
}

// Signed in: sign up once, then measure the same pages in the same context so
// cookies persist. A saved paddle is added when the account has one.
test('sweep (signed in)', async ({ page }) => {
  test.setTimeout(180_000)
  const email = `sweep-${randomUUID().slice(0, 8)}@example.com`
  let signedIn = false
  let signUpError = ''
  try {
    await signUp(page, email)
    signedIn = true
  } catch (e) {
    signUpError = e instanceof Error ? e.message : String(e)
    console.log(`sweep: sign-up failed — ${signUpError}`)
  }
  if (!signedIn) {
    // Sign-up is blocked (e.g. the page crashes under the night-shift's webpack
    // dev, so the form never renders). Record the blocker once instead of
    // re-measuring every page as "not signed in" — the signed-out pass already
    // measured them, and a sign-up failure is not a page-load failure.
    const r: PageResult = {
      key: 'signed-in (blocked)',
      url: 'sign-up',
      state: 'signed-in',
      loaded: true,
      overlay: true,
      overlayError: `sign-up blocked: ${signUpError}`,
      axeViolations: [],
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      responses4xx: [],
    }
    writePage(r)
    console.log(`sweep: signed-in pass blocked — ${r.overlayError}`)
    return
  }
  const paddle = await page.evaluate(async () => {
    const r = await fetch('/att/api/paddles')
    if (!r.ok) return null
    const body = await r.json().catch(() => null)
    const list = Array.isArray(body) ? body : body?.paddles ?? body?.items
    return list && list.length ? String(list[0].id ?? list[0].paddleId) : null
  }).catch(() => null)
  const extra = paddle ? [`/paddles/${paddle}`] : []
  console.log(`sweep: ${extra.length ? 'saved paddle ' + extra[0] + ' included' : 'no saved paddle (never seeded) — skipped'}`)
  for (const url of [...PAGES, ...extra]) {
    const r = await measure(page, url, 'signed-in')
    if (!r.loaded) throw new Error(`page did not load: ${r.loadError}`)
  }
})

// Final pass: aggregate every per-page file written this stamp into a summary.
test('sweep: summary', async () => {
  const files = readdirSync(OUT_DIR).filter(f => f.startsWith(`${STAMP}__`))
  const pages: PageResult[] = []
  for (const f of files) {
    try {
      pages.push(JSON.parse(readFileSync(join(OUT_DIR, f), 'utf8')))
    } catch { /* skip a half-written file */ }
  }
  const perPage: Record<string, { raw: number; product: number; overlay: boolean }> = {}
  let rawTotal = 0
  let productTotal = 0
  let pagesBlocked = 0
  const loadFailures: string[] = []
  // Group the overlay-crashed pages by their runtime crash. The recurring
  // night-shift blocker is ONE shared crash (e.g. a casing collision in a shared
  // package) that hits every page, so the summary should say "N pages down on the
  // same crash" rather than N rows. Key on the runtime pageerror (identical across
  // the crashed pages) — NOT the overlay's textContent, which starts with each
  // page's own title and so splits one crash into N buckets.
  const crashes: Record<string, number> = {}
  for (const p of pages) {
    perPage[p.key] = { raw: problemCount(p), product: productCount(p), overlay: p.overlay }
    rawTotal += problemCount(p)
    productTotal += productCount(p)
    if (!p.loaded) loadFailures.push(`${p.key}: ${p.loadError ?? 'unknown'}`)
    if (p.overlay) {
      pagesBlocked++
      const key = (p.pageErrors[0] || p.overlayError || 'overlay (no text)')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .slice(0, 160)
        .trim()
      crashes[key] = (crashes[key] ?? 0) + 1
    }
  }
  writeFileSync(join(OUT_DIR, `${STAMP}__summary.json`), JSON.stringify({
    stamp: STAMP,
    pages: pages.length,
    rawTotal,
    productTotal,
    pagesBlocked,
    // crash -> how many pages it took down, most-blocked first.
    crashes: Object.fromEntries(
      Object.entries(crashes).sort((a, b) => b[1] - a[1]),
    ),
    loadFailures,
    perPage,
  }, null, 2))
  // The sweep fails only when a page did not load.
  expect(loadFailures, loadFailures.join('\n')).toEqual([])
})
