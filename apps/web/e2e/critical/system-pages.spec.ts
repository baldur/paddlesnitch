import { test, expect } from '@playwright/test'

// The pages people land on when something is off: an unknown link and the
// Terms. Both used to fall outside the site's design (Next's white 404 page,
// raw Markdown on /terms).

test('an unknown URL shows our own not-found page, inside the site', async ({ page }) => {
  const res = await page.goto('/no-such-page-anywhere')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: "We can't find that page" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
})

test('the Terms page shows formatted text, not Markdown', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '1. Who can use the Service' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('## ')
  await expect(page.locator('main')).not.toContainText('**')
})
