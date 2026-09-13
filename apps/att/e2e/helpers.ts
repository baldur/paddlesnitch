import { Page, expect } from '@playwright/test'
import { randomUUID } from 'crypto'

// Helpers shared across E2E specs. Keep the surface small — each helper
// should pay for itself by appearing in >1 test. The dial we're tuning
// is "individual specs read as a script of user actions".

export function freshEmail(prefix = 'e2e'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`
}

// Runs the full signup form including the ToS checkbox. Leaves the
// session signed in at /att. Tests that need a logged-in user but
// don't care about the signup flow itself call this in a beforeEach.
export async function signUpFlow(
  page: Page,
  opts: { email?: string; displayName?: string; password?: string } = {},
): Promise<{ email: string; displayName: string }> {
  const email = opts.email ?? freshEmail()
  const displayName = opts.displayName ?? 'E2E User'
  const password = opts.password ?? 'Password123'

  await page.goto('/att/auth')
  // The auth page renders three tab <button> elements (SIGN IN /
  // SIGN UP / EMAIL CODE) above whichever form is active. The form's
  // submit button reads "CREATE ACCOUNT", which keeps tab and submit
  // distinguishable. Pick the SIGN UP tab first.
  await page.getByRole('button', { name: 'SIGN UP', exact: true }).click()
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[autocomplete="name"]').fill(displayName)
  await page.locator('input[type="password"]').fill(password)
  await page.getByLabel(/I have read and agree/i).check()

  await page.getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).click()
  await expect(page).toHaveURL('/', { timeout: 10_000 })
  return { email, displayName }
}

// Same shape, for an already-existing account.
export async function signInFlow(
  page: Page,
  email: string,
  password = 'Password123',
): Promise<void> {
  await page.goto('/att/auth')
  // SIGN IN is the default tab; just fill and submit. The submit
  // button reads "SIGN IN" too, but the tab's "SIGN IN" button is
  // also visible — both are valid targets at this point because
  // clicking either lands you in the signed-in state once the form
  // is filled. Disambiguate by targeting type=submit.
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]:has-text("SIGN IN")').click()
  await expect(page).toHaveURL('/', { timeout: 10_000 })
}

// Clears auth cookies so the rest of the spec runs as an anonymous
// visitor. Easier than spinning up a fresh browser context for the
// "non-member can't see this" assertions.
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies()
}

// -----------------------------------------------------------------------
// API helpers — same route handlers as the UI, just skips the parts that
// would require interacting with the Leaflet map. Course geometry is
// pinned to a coordinate range that matches the GPX returned by
// `gpxThatCrossesDefaultCourse()` below so upload→leaderboard works.
// -----------------------------------------------------------------------

// Coordinates chosen so the generated GPX track crosses both lines.
// Track moves north along longitude -0.9, lat 51.50 → 51.60 in 0.01°
// steps. Start at lat 51.525, finish at lat 51.575 sit cleanly inside.
const COURSE_START_LINE: [[number, number], [number, number]] = [[51.525, -0.91], [51.525, -0.89]]
const COURSE_FINISH_LINE: [[number, number], [number, number]] = [[51.575, -0.91], [51.575, -0.89]]

export async function createCourseViaApi(
  page: Page,
  opts: {
    name?: string
    visibility?: 'public' | 'private' | 'group'
    // The owning group (phase 2). Defaults to a fresh group owned by the
    // current user, so the caller is automatically a group admin.
    groupId?: string
    sport?: 'kayak' | 'rowing' | 'both'
  } = {},
): Promise<{ id: string; name: string }> {
  const name = opts.name ?? `E2E Course ${randomUUID().slice(0, 6)}`
  const groupId = opts.groupId ?? (await createGroupViaApi(page)).id
  const res = await page.request.post('/att/api/courses', {
    data: {
      name,
      sport: opts.sport ?? 'kayak',
      type: 'point_to_point',
      startLine: COURSE_START_LINE,
      finishLine: COURSE_FINISH_LINE,
      distanceMetres: 5560,
      groupId,
      visibility: opts.visibility ?? 'public',
    },
  })
  expect(res.status(), 'createCourseViaApi expects 201').toBe(201)
  const body = await res.json()
  return { id: body.id, name: body.name }
}

export async function createTrialViaApi(
  page: Page,
  courseId: string,
  opts: {
    name?: string
    date?: string
    visibility?: 'public' | 'private' | 'group'
  } = {},
): Promise<{ id: string; name: string }> {
  const name = opts.name ?? `E2E Trial ${randomUUID().slice(0, 6)}`
  const res = await page.request.post('/att/api/trials', {
    data: {
      courseId,
      name,
      date: opts.date ?? '2025-06-01',
      visibility: opts.visibility ?? 'public',
    },
  })
  expect(res.status(), 'createTrialViaApi expects 201').toBe(201)
  const body = await res.json()
  return { id: body.id, name: body.name }
}

export async function createGroupViaApi(
  page: Page,
  opts: { name?: string } = {},
): Promise<{ id: string; name: string }> {
  const name = opts.name ?? `E2E Group ${randomUUID().slice(0, 6)}`
  const res = await page.request.post('/att/api/groups', { data: { name } })
  expect(res.status(), 'createGroupViaApi expects 201').toBe(201)
  const body = await res.json()
  return { id: body.id, name: body.name }
}

// Returns a path to a GPX file that crosses the course built by
// `createCourseViaApi()`. The track has 11 points moving north along
// lng -0.9, lat 51.50 → 51.60 in 0.01° steps, mirroring the vitest
// integration suite's `makeTestTrack`. Writes a temp file once per
// process; subsequent calls reuse it.
import { tmpdir } from 'os'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

let cachedGpxPath: string | undefined
export function gpxThatCrossesDefaultCourse(): string {
  if (cachedGpxPath && existsSync(cachedGpxPath)) return cachedGpxPath
  const trkpts = Array.from({ length: 11 }, (_, i) => {
    const lat = (51.50 + i * 0.01).toFixed(4)
    const lng = -0.9
    const time = new Date(Date.UTC(2025, 5, 1, 10, i, 0)).toISOString()
    return `<trkpt lat="${lat}" lon="${lng}"><time>${time}</time></trkpt>`
  }).join('\n')
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${trkpts}</trkseg></trk></gpx>`
  const dir = mkdtempSync(join(tmpdir(), 'e2e-gpx-'))
  const path = join(dir, 'crosses.gpx')
  writeFileSync(path, gpx, 'utf8')
  cachedGpxPath = path
  return path
}
