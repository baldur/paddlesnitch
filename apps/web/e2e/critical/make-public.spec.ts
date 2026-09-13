import { test, expect } from '@playwright/test'
import {
  signUpFlow,
  createCourseViaApi,
  createTrialViaApi,
  signOut,
} from '../helpers'

// Critical path #5 of 5: the make-public acknowledgement flow.
//
// A private trial is invisible to anyone but the owner. Flipping it to
// public triggers a window.confirm so the owner has to explicitly
// acknowledge that performance times will become visible (per the ToS).
// Server enforces the same — the PATCH route 422s if the body's missing
// acknowledged: true (see src/tests/make-public-ack.test.ts).
//
// This spec checks the end-to-end flow: the confirm fires, accepting it
// flips the trial, and the trial page is now reachable to logged-out
// visitors.

test('the owner can flip a private trial to public via the ack confirm', async ({ page }) => {
  await signUpFlow(page, { displayName: 'Trial Organiser' })

  // Public course (so trial visibility isn't clamped to private),
  // private trial on it.
  const course = await createCourseViaApi(page)
  const trial = await createTrialViaApi(page, course.id, {
    visibility: 'private',
    name: 'Private Trial Flip Test',
  })

  // Go straight to the admin page (the owner can see this view).
  await page.goto(`/att/admin/trials/${trial.id}`)

  // Accept the window.confirm before clicking. Playwright queues a
  // one-shot listener that auto-accepts the first native dialog. The
  // server requires acknowledged: true in the body, which the page's
  // toggleVisibility handler only sends after the confirm returns.
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /PRIVATE.*↔.*PUBLIC/ }).click()

  // After the PATCH succeeds, the admin page re-renders with the
  // inverted button label.
  await expect(page.getByRole('button', { name: /PUBLIC.*↔.*PRIVATE/ }))
    .toBeVisible({ timeout: 10_000 })

  // Sign out and confirm the trial detail page is now reachable to
  // anonymous visitors (it was 404 to them while private).
  await signOut(page)
  const res = await page.goto(`/att/trials/${trial.id}`)
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: /PRIVATE TRIAL FLIP TEST/i })).toBeVisible()
})
