import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { signUpFlow } from '../helpers'

// Critical path: Download my data (GDPR Art. 15) gives a file of your data.
// It failed for accounts with many paddles (a Lambda answer is capped at
// 6 MB); the page now asks for a link and downloads from it (#392). Locally
// the link is the direct download.

test('Download my data saves a file with your account in it', async ({ page }) => {
  const { email } = await signUpFlow(page)
  await page.goto('/account')
  const button = page.getByRole('button', { name: /DOWNLOAD MY DATA/ })
  await expect(button).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), button.click()])
  expect(download.suggestedFilename()).toMatch(/^paddlesnitch-data-.+\.json$/)
  const data = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(data.user.email).toBe(email)
  expect(Array.isArray(data.paddles)).toBe(true)
})
