import { test, expect } from '@playwright/test'
import {
  signUpFlow,
  createCourseViaApi,
  createTrialViaApi,
  gpxThatCrossesDefaultCourse,
} from '../helpers'

// Critical path #3 of 5: full GPS-trace upload → leaderboard render.
//
// This is the heart of the product. We exercise the upload form (real
// file input, real multipart POST), the parse → processTrace pipeline,
// the leaderboard rebuild, and the public trial page render — all in
// one go.
//
// Course + trial are seeded via API to skip the map UI. The GPX is a
// generated track that crosses the seeded course's start + finish
// lines (helpers.gpxThatCrossesDefaultCourse).

test('uploading a GPX trace produces a leaderboard entry', async ({ page }) => {
  // cognito-local doesn't include the `name` claim in its JWT, so
  // getAuthUser() (and therefore the persisted leaderboard entry's
  // displayName) falls back to the email's local part. Asserting on
  // that local part is the reliable signal here — `displayName`
  // passed to signUpFlow isn't what reaches the leaderboard until we
  // run against real Cognito in production.
  const { email } = await signUpFlow(page, { displayName: 'Paddler One' })
  const leaderboardName = email.split('@')[0]

  const course = await createCourseViaApi(page)
  const trial = await createTrialViaApi(page, course.id, { date: '2025-06-01' })

  // Drive the upload through the UI to exercise the full client flow.
  await page.goto(`/att/trials/${trial.id}/upload`)

  // Pick the boat class first because it gates the crew editor and
  // auto-prefills bow seat 1 with the signed-in user's display name.
  await page.locator('select').first().selectOption('K1')

  // The race date is now inferred from the trace itself (#123/#134) —
  // there's no date picker to fill anymore.

  // Attach the file. Playwright's setInputFiles handles the
  // hidden-input pattern transparently.
  await page.locator('input[type="file"]').setInputFiles(gpxThatCrossesDefaultCourse())

  await page.getByRole('button', { name: 'SUBMIT TRACE' }).click()

  // On success the page redirects to the public trial detail. The
  // leaderboard table renders with our row visible.
  await expect(page).toHaveURL(`/att/trials/${trial.id}`, { timeout: 15_000 })
  await expect(page.getByRole('cell', { name: leaderboardName })).toBeVisible()
})
