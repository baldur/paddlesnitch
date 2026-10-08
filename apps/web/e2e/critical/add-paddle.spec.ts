import { test, expect } from '@playwright/test'
import path from 'path'
import { signUpFlow } from '../helpers'

// Critical path: add a paddle from a file, open it, find it in the list.
//
// Paddles is the signed-in home, and this flow changed three times on
// 2026-10-08: the list and the paddle arrive with their data in the first
// HTML (#388), the paddle opens before its AI summary (#390), and big files
// are compressed before upload (#394).

test('a paddle added from a file opens, and is in the list', async ({ page }) => {
  await signUpFlow(page)
  await page.goto('/paddles/new')

  // A file chosen before the page has hydrated is lost (React isn't listening
  // yet), so choose until ANALYSE lights up.
  const analyse = page.getByRole('button', { name: 'ANALYSE', exact: true })
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, '../../src/tests/fixtures/garmin-activity-export.zip'))
    await expect(analyse).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await analyse.click()

  // The paddle's own page, not ADD A PADDLE.
  await expect(page).toHaveURL(/\/paddles\/(?!new$)[^/]+$/, { timeout: 30_000 })
  const id = new URL(page.url()).pathname.split('/').pop()!
  // Its numbers are there, and the summary line settles (no AI locally: the
  // plain summary stays, the "writing" line goes).
  await expect(page.getByText(/km/).first()).toBeVisible()
  await expect(page.getByText('Writing your summary…')).toHaveCount(0, { timeout: 20_000 })

  await page.goto('/paddles')
  await expect(page.locator(`a[href="/paddles/${id}"]`).first()).toBeVisible()
})
