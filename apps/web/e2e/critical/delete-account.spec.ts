import { test, expect } from '@playwright/test'
import { signUpFlow } from '../helpers'

// Critical path: Delete account (GDPR Art. 17). Someone who has just signed in
// can delete at once; deleting needs a sign-in from the last 10 minutes
// (2026-10-25), which a fresh sign-up is. Afterwards they're signed out.

test('Delete account erases the account and signs you out', async ({ page }) => {
  await signUpFlow(page)
  await page.goto('/account#delete')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByLabel(/Type DELETE to confirm/).fill('DELETE')
  await page.getByRole('button', { name: 'Delete for good' }).click()
  await page.waitForURL(/\/att$/)
  // Signed out: the account page now asks to sign in.
  await page.goto('/account')
  await expect(page).toHaveURL(/\/signin/)
})
