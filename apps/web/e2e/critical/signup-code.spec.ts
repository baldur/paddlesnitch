import { test, expect } from '@playwright/test'
import { freshEmail, signUpCode } from '../helpers'
import { CURRENT_TOS_VERSION } from '../../src/lib/types'

// Sign-up proves the email (#702). Someone who started an account but never
// entered the code, and later signs in with the right password, gets the code
// step (not an error), a new code, and is signed in once it's entered (then
// asked to accept the Terms, which weren't ticked on this visit).
test('signing in to an account whose code was never entered asks for the code, then signs in', async ({ page, request }) => {
  const email = freshEmail('signup-code')
  const started = await request.post('/att/api/auth/signup', {
    data: { email, displayName: 'Late Confirmer', password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION },
  })
  expect(started.status()).toBe(202)

  await page.goto('/signin')
  await page.locator('#signin-email').fill(email)
  await page.locator('#signin-password').fill('Password123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Confirm your email first')
  // cognito-local has no "resend", so the first code still stands.
  await page.getByLabel('Code', { exact: true }).fill(await signUpCode(email))
  await page.getByRole('button', { name: 'Confirm email', exact: true }).click()
  // Signed in. Nothing was ticked on this visit, so the Terms come first.
  await expect(page).toHaveURL(/\/terms\/accept/, { timeout: 10_000 })
})
