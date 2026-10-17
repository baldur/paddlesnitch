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

test('zoomed out, a click zooms in; a start off the water is moved by the next click', async ({ page }) => {
  await page.goto('/plan')   // the whole UK and Ireland: a click there is kilometres wide
  const map = page.locator('.leaflet-container')
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText('Click the water to set your start.')).toBeVisible()
  await expect(page).not.toHaveURL(/from=/)

  // A start in a field near Reading, with the map close in on the Kennet.
  await page.goto('/plan?from=51.32,-1.2&view=51.4566,-0.9581,15')
  await expect(page.getByText(/The start isn.t on a river or canal/)).toBeVisible({ timeout: 15_000 })
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText(/The start isn.t on a river or canal/)).toHaveCount(0)
  await expect(page.getByText('Now click the water where you finish.')).toBeVisible()
})

test('coverage: the map colours the water by what we know, and the gaps page lists it', async ({ page }) => {
  await page.goto('/plan?view=51.45,-1.2,9')
  await page.getByRole('button', { name: 'COVERAGE' }).click()
  await expect(page.getByTestId('coverage-legend')).toContainText('How well we know each waterway')
  await page.getByRole('link', { name: /Every waterway and its gaps/ }).click()
  await expect(page).toHaveURL(/\/plan\/gaps$/)
  const table = page.getByTestId('gaps-table')
  await expect(table).toContainText('Kennet and Avon Canal', { timeout: 15_000 })
  await page.getByLabel('Find a waterway').fill('thames')
  await expect(table).not.toContainText('Kennet and Avon Canal')
  await expect(table).toContainText('River Thames')
})

test('the places search moves the map to a lock', async ({ page }) => {
  await page.goto('/plan')
  const box = page.getByLabel('Go to a place')
  await box.click()
  await box.fill('marsh lo')
  await page.getByRole('option', { name: /^Marsh Lock/ }).click()
  await expect(box).toHaveValue('Marsh Lock')
  await expect(page.getByRole('listbox')).toHaveCount(0)
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

test('OpenPortage: a paddler adds portage details at a lock and sees them on the route', async ({ page }) => {
  await signUpFlow(page, { displayName: 'Lock Keeper' })
  // Henley downstream to Hambleden, through Hambleden Lock.
  await page.goto('/plan?from=51.5395,-0.9010&to=51.5470,-0.8740')
  await expect(page.getByTestId('plan-summary')).toContainText('km', { timeout: 15_000 })
  const lock = page.getByTestId('stop-list').locator('li', { hasText: 'Hambleden Lock' })
  await lock.getByRole('button', { name: /ADD PORTAGE DETAILS/ }).click()

  const panel = page.getByTestId('add-portage')
  await expect(panel).toContainText('Click the map where you get out')
  const box = (await page.locator('.leaflet-container').boundingBox())!
  await page.mouse.click(box.x + box.width / 2 - 40, box.y + box.height / 2)
  await expect(panel).toContainText('Now click where you get back in')
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2)
  await panel.getByLabel('Portage notes').fill('Steps by the lock cottage')
  await panel.getByLabel('Release under CC0').check()
  await panel.getByRole('button', { name: 'PUBLISH' }).click()

  await expect(panel).toHaveCount(0)
  await expect(lock).toContainText('Added by Lock Keeper', { timeout: 15_000 })
  await expect(lock).toContainText('Steps by the lock cottage')
  await expect(lock).not.toContainText('Portage side not known yet.')
})
