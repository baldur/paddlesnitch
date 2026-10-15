import { test, expect } from '@playwright/test'
import { signUpFlow } from '../helpers'

// Critical path: plan a paddle by clicking the water, and open a plan from a
// link. No account needed (docs/features/river-planner.md).

test('two clicks on the water give a route and its stops', async ({ page }) => {
  // Centred on the Kennet where it meets the Thames at Reading.
  await page.goto('/plan?view=51.4566,-0.9581,15')
  const map = page.locator('.leaflet-container')
  await expect(map).toBeVisible()
  await expect(page.getByText('Click the water to set your start.')).toBeVisible({ timeout: 15_000 })
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText('Now click the water where you finish.')).toBeVisible()
  await page.mouse.click(box.x + box.width / 2 + 250, box.y + box.height / 2 - 60)

  await expect(page.getByTestId('plan-summary')).toContainText('DISTANCE')
  await expect(page.getByTestId('stop-list')).toContainText('Portage side not known yet.')
  await expect(page).toHaveURL(/from=.*&to=/)   // the plan is in the address bar

  // SATELLITE swaps the dark map for aerial imagery, to see where to land.
  await page.getByRole('button', { name: 'SATELLITE' }).click()
  await expect(page.getByRole('button', { name: 'SATELLITE' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('img.leaflet-tile[src*="World_Imagery"]').first()).toBeAttached()
})

test('a plan link opens the whole Devizes to Westminster route', async ({ page }) => {
  await page.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667')
  const summary = page.getByTestId('plan-summary')
  await expect(summary).toContainText('201.3 km', { timeout: 15_000 })
  await expect(summary).toContainText('77')
  await expect(page.getByTestId('stop-list')).toContainText('Teddington Lock')
  await page.getByRole('button', { name: 'RETURN' }).click()
  await expect(summary).toContainText('402.6 km')
  await expect(page.getByTestId('stop-list')).toContainText(/TURN AT/)
})

test('a saved, shared plan opens from its link for someone signed out', async ({ browser }) => {
  const ownerCtx = await browser.newContext(), guestCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  await signUpFlow(owner, { displayName: 'Plan Owner' })
  await owner.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667')
  await expect(owner.getByTestId('plan-summary')).toContainText('201.3 km', { timeout: 15_000 })
  await owner.getByLabel('Plan name').fill('DW crew plan')
  await owner.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(owner).toHaveURL(/\/plan\/(?!shared)[^/?]+$/, { timeout: 15_000 })

  await owner.getByRole('button', { name: 'SHARE', exact: true }).click()
  const link = (await owner.getByTestId('share-link').innerText()).trim()
  expect(link).toMatch(/\/plan\/shared\/[\w-]+$/)

  const guest = await guestCtx.newPage()
  await guest.goto(new URL(link).pathname)
  await expect(guest.getByText('Shared by Plan Owner.', { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(guest.getByTestId('plan-summary')).toContainText('201.3 km')

  await owner.getByRole('button', { name: 'STOP SHARING' }).click()
  await expect(owner.getByRole('button', { name: 'SHARE', exact: true })).toBeVisible()
  await guest.reload()
  await expect(guest.getByText("We can't find this plan.", { exact: false })).toBeVisible()
  await ownerCtx.close(); await guestCtx.close()
})
