import { test, expect } from '@playwright/test'
import { signUpFlow, createCourseViaApi } from '../helpers'

// Critical path #2 of 5: a signed-in user creates a course and finds
// it in the catalogue.
//
// Course creation goes through the Leaflet DrawingMap, which is its
// own bespoke component — we skip the UI map drawing here and POST
// via /att/api/courses with the auth cookie set. Same route handler,
// same cookie flow, same DB; what we lose is map-drag testing, which
// belongs in component tests (and a manual smoke pass before deploy
// per CLAUDE.md).
//
// What this DOES test end-to-end: signup → cookie set → authenticated
// POST → catalogue server-render → course appears.

test('a signed-in user creates a course and sees it in the catalogue', async ({ page }) => {
  await signUpFlow(page, { displayName: 'Course Creator' })

  // Default name has a random UUID suffix so the catalogue link is
  // unique across test runs (.local-data/ accumulates).
  const course = await createCourseViaApi(page)

  await page.goto('/att/courses')
  // The catalogue page lists course names as links to /att/courses/<id>.
  // Filter by href so we match exactly our just-created course even if
  // a stale run left a course with a similar name behind.
  const link = page.locator(`a[href="/att/courses/${course.id}"]`)
  await expect(link).toBeVisible()
  await expect(link).toContainText(course.name)

  // Drill in to the detail page and confirm we're allowed to see it.
  await link.click()
  await expect(page).toHaveURL(`/att/courses/${course.id}`)
  await expect(page.getByRole('heading', { name: new RegExp(course.name.toUpperCase()) })).toBeVisible()
})
