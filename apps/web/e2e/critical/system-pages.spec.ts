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

test('help and troubleshooting fold each answer under its question; a link opens the one it points at', async ({ page }) => {
  await page.goto('/help')
  const first = page.locator('details').first()
  await expect(first).not.toHaveAttribute('open', '')
  await first.locator('summary').click()
  await expect(first).toHaveAttribute('open', '')

  await page.goto('/guide/troubleshooting#wifi')
  await expect(page.locator('details#wifi')).toHaveAttribute('open', '')
  await expect(page.locator('details#screen')).not.toHaveAttribute('open', '')
})
