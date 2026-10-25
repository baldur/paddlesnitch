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

// Past the 10 minutes, the page asks for a fresh sign-in BEFORE anyone types
// DELETE, and brings them straight back to an open Delete account. The first
// check is answered as "too old" (the clock can't be moved in a browser);
// after signing in again the real check says yes.
test('An old sign-in is asked to sign in again first, then comes back to Delete account', async ({ page, context }) => {
  const { email } = await signUpFlow(page)
  let firstCheck = true
  await page.route('**/api/account', route => {
    if (route.request().method() === 'GET' && firstCheck) {
      firstCheck = false
      return route.fulfill({ status: 200, json: { recentSignIn: false } })
    }
    return route.continue()
  })
  await page.goto('/account#delete')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  // No DELETE box yet: a calm note and a way to sign in again.
  await expect(page.getByText(/deleting your account needs a recent sign-in/)).toBeVisible()
  await expect(page.getByLabel(/Type DELETE to confirm/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign in again' }).click()

  // Signed out, on the sign-in page with the reason shown.
  await page.waitForURL(/\/signin\?reason=reauth_delete/)
  expect((await context.cookies()).some(c => c.name === 'tt_id' && c.value)).toBe(false)
  await expect(page.getByRole('status')).toContainText('recent sign-in')
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').fill('Password123')
  await page.locator('button[type="submit"]:has-text("SIGN IN")').click()

  // Back on Delete account, already open at the DELETE step.
  await page.waitForURL(/\/account/)
  await expect(page.getByLabel(/Type DELETE to confirm/)).toBeVisible()
})

// The 10 minutes can run out while someone types DELETE: the page goes back
// to the Sign in again step, without signing them out by itself.
test('If the sign-in gets too old while typing, Delete account asks to sign in again', async ({ page, context }) => {
  await signUpFlow(page)
  await page.route('**/api/account', route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 403, json: { error: 'For your safety, deleting your account needs a recent sign-in. Please sign in again.', reauth: true } })
    : route.continue())
  await page.goto('/account#delete')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByLabel(/Type DELETE to confirm/).fill('DELETE')
  await page.getByRole('button', { name: 'Delete for good' }).click()
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible()
  await expect(page.getByLabel(/Type DELETE to confirm/)).toHaveCount(0)
  // Still signed in: nothing happened behind their back.
  expect((await context.cookies()).some(c => c.name === 'tt_id' && c.value)).toBe(true)
})
