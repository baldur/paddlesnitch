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

  await expect(page.getByTestId('plan-summary')).toContainText('Distance')
  await expect(page.getByTestId('stop-list')).toContainText('Portage side not known yet.')
  await expect(page).toHaveURL(/from=.*&to=/)   // the plan is in the address bar

  // Satellite swaps the dark map for aerial imagery, to see where to land.
  await page.getByRole('button', { name: 'Satellite' }).click()
  await expect(page.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('img.leaflet-tile[src*="World_Imagery"]').first()).toBeAttached()
})

test('a whole plan from the keyboard: start and finish by name (#506)', async ({ page }) => {
  await page.goto('/plan')
  await page.getByRole('combobox', { name: 'Start' }).fill('Guyers')
  await expect(page.getByRole('option').first()).toContainText('Kennet and Avon Canal', { timeout: 15_000 })
  await page.keyboard.press('Enter')
  await expect(page.getByText('On Kennet and Avon Canal.')).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.type('Aldermaston Wharf')
  await expect(page.getByRole('option').first()).toContainText('wharf')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('plan-summary')).toContainText('Distance', { timeout: 15_000 })
  await expect(page).toHaveURL(/from=.*&to=/)
})

test('a hand-written link names its ends, and the address becomes coordinates (#508)', async ({ page }) => {
  await page.goto('/plan?from=guyers-lock&to=Aldermaston%20Wharf')
  await expect(page.getByTestId('plan-summary')).toContainText('Distance', { timeout: 15_000 })
  await expect(page).toHaveURL(/from=-?\d+\.\d+,-?\d+\.\d+&to=-?\d+\.\d+,-?\d+\.\d+/)

  await page.goto('/plan?from=atlantis')
  await expect(page.getByText(/We couldn.t find .atlantis. on the water/)).toBeVisible({ timeout: 15_000 })

  // The parameters are written down for anyone making links.
  await page.goto('/help')
  await expect(page.getByTestId('plan-params')).toContainText('waterway')
})

test('zoomed out, a click zooms in; a start off the water is moved by the next click', async ({ page }) => {
  // Zoomed out over the UK and Ireland: a click there is kilometres wide.
  // (/plan itself opens on Reading, close enough to click the water.)
  await page.goto('/plan?view=54.5,-4,6')
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
  await page.getByRole('button', { name: 'Coverage' }).click()
  await expect(page.getByTestId('coverage-legend')).toContainText('How well we know each waterway')
  await page.getByRole('link', { name: /Every waterway and its gaps/ }).click()
  await expect(page).toHaveURL(/\/plan\/gaps$/)
  const table = page.getByTestId('gaps-table')
  await expect(table).toContainText('Kennet and Avon Canal', { timeout: 15_000 })
  await page.getByLabel('Find a waterway').fill('thames')
  await expect(table).not.toContainText('Kennet and Avon Canal')
  await expect(table).toContainText('River Thames')
})

test('with nothing in the link, the planner opens close in on Reading, ready for a click', async ({ page }) => {
  await page.goto('/plan')
  const map = page.locator('.leaflet-container')
  await expect(page.getByText('Click the water to set your start.')).toBeVisible({ timeout: 15_000 })
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  // Close enough in that a click places the start (on the water or not)
  // rather than zooming in.
  await expect(page).toHaveURL(/from=/)
})

test('the route prints as a route sheet and a crew sheet', async ({ page }) => {
  await page.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667&at=2027-04-17T07:00:00.000Z')
  await expect(page.getByTestId('plan-summary')).toContainText('km', { timeout: 15_000 })
  await page.getByRole('link', { name: 'Print route sheet' }).click()
  await expect(page).toHaveURL(/\/plan\/print\?from=.*&show=/)
  const sheet = page.getByTestId('print-sheet')
  await expect(sheet).toContainText('Route sheet', { timeout: 15_000 })
  await expect(page.getByTestId('print-stops')).toContainText('Teddington Lock')
  await page.getByRole('link', { name: 'Crew sheet instead' }).click()
  await expect(sheet).toContainText('Crew sheet')
  await expect(page.getByTestId('print-stops')).toContainText(/RG\d \d[A-Z]{2}/)   // a postcode a crew can drive to
})

test('your own notes, on the plan and on a stop, print on the sheet', async ({ page }) => {
  await signUpFlow(page)
  await page.goto('/plan?from=51.5395,-0.9010&to=51.5470,-0.8740')
  await expect(page.getByTestId('plan-summary')).toContainText('km', { timeout: 15_000 })
  await page.getByLabel('Plan name').fill('Henley loop')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/\/plan\/(?!shared)[^/?]+$/, { timeout: 15_000 })

  await page.getByLabel('Your notes for this plan').fill('Spare paddle in the car')
  await page.getByRole('button', { name: 'Save notes' }).click()
  await expect(page.getByRole('button', { name: 'Save notes' })).toBeDisabled()
  const lock = page.getByTestId('stop-list').locator('li', { hasText: 'Hambleden Lock' })
  await lock.getByRole('button', { name: '+ Add a note' }).click()
  await lock.getByLabel(/Your note on Hambleden Lock/).fill('Crew meets here with food')
  await lock.getByRole('button', { name: 'Save note' }).click()
  await expect(lock).toContainText('Your note: Crew meets here with food')

  await page.getByRole('link', { name: 'Print route sheet' }).click()
  const sheet = page.getByTestId('print-sheet')
  await expect(sheet).toContainText('Henley loop', { timeout: 15_000 })
  await expect(sheet).toContainText('Spare paddle in the car')
  await expect(sheet).toContainText('Note: Crew meets here with food')
})

test('conditions: a dawn start shows sunrise and sunset and the stops reached in the dark', async ({ page }) => {
  await page.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667&at=2027-04-17T04:00:00.000Z')
  const conditions = page.getByTestId('conditions')
  await expect(conditions).toContainText('Conditions now', { timeout: 15_000 })
  await expect(page.getByTestId('daylight')).toContainText(/Sunrise \d\d:\d\d, sunset \d\d:\d\d on your start day\. \d+ stops? reached in the dark\./)
  await expect(page.getByTestId('stop-list')).toContainText('after dark')
  // The route reaches the tideway at Teddington: our own tide fit says when high water is.
  await expect(page.getByTestId('tide')).toContainText(/high water at Richmond/)
  await expect(page.getByTestId('tide')).toContainText('Not for navigation')
})

test('portage nudges: a plan says which locks lack landing details, and a lock link opens the add panel', async ({ page }) => {
  await page.goto('/plan?from=51.5395,-0.9010&to=51.5470,-0.8740')
  await expect(page.getByTestId('missing-sides')).toContainText('1 lock on this route has no landing details yet', { timeout: 15_000 })
  await expect(page.getByTestId('missing-sides')).toContainText('Sign in to add what you know')

  await page.goto('/plan?lock=ea-lock%3Ahambleden&lockAt=51.560400,-0.868700&lockName=Hambleden+Lock&view=51.560400,-0.868700,18')
  const panel = page.getByTestId('add-portage')
  await expect(panel).toContainText('Portage details: Hambleden Lock')
  await expect(panel.getByRole('link', { name: 'Sign in' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Return' }).click()
  await expect(summary).toContainText('402.6 km')
  await expect(page.getByTestId('stop-list')).toContainText(/Turn at/)
})

test('a saved, shared plan opens from its link for someone signed out', async ({ browser }) => {
  const ownerCtx = await browser.newContext(), guestCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  await signUpFlow(owner, { displayName: 'Plan Owner' })
  await owner.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667')
  await expect(owner.getByTestId('plan-summary')).toContainText('201.3 km', { timeout: 15_000 })
  await owner.getByLabel('Plan name').fill('DW crew plan')
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(owner).toHaveURL(/\/plan\/(?!shared)[^/?]+$/, { timeout: 15_000 })

  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const link = (await owner.getByTestId('share-link').innerText()).trim()
  expect(link).toMatch(/\/plan\/shared\/[\w-]+$/)

  const guest = await guestCtx.newPage()
  await guest.goto(new URL(link).pathname)
  await expect(guest.getByText('Shared by Plan Owner.', { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(guest.getByTestId('plan-summary')).toContainText('201.3 km')

  await owner.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(owner.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await guest.reload()
  await expect(guest.getByText("We can't find this plan", { exact: false })).toBeVisible()
  await ownerCtx.close(); await guestCtx.close()
})

test('OpenPortage: a paddler adds portage details at a lock and sees them on the route', async ({ page }) => {
  await signUpFlow(page, { displayName: 'Lock Keeper' })
  // Henley downstream to Hambleden, through Hambleden Lock.
  await page.goto('/plan?from=51.5395,-0.9010&to=51.5470,-0.8740')
  await expect(page.getByTestId('plan-summary')).toContainText('km', { timeout: 15_000 })
  const lock = page.getByTestId('stop-list').locator('li', { hasText: 'Hambleden Lock' })
  // "+ Add yours" when someone (a retry of this test) already added theirs.
  await lock.getByRole('button', { name: /Add (portage details|yours)/ }).click()

  const panel = page.getByTestId('add-portage')
  await expect(panel).toContainText('Click the map where you get out')
  const box = (await page.locator('.leaflet-container').boundingBox())!
  await page.mouse.click(box.x + box.width / 2 - 40, box.y + box.height / 2)
  await expect(panel).toContainText('Now click where you get back in')
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2)
  await panel.getByLabel('Portage notes').fill('Steps by the lock cottage')
  await panel.getByLabel('Release under CC0').check()
  await panel.getByRole('button', { name: 'Publish' }).click()

  await expect(panel).toHaveCount(0)
  await expect(lock).toContainText('Added by Lock Keeper', { timeout: 15_000 })
  await expect(lock).toContainText('Steps by the lock cottage')
  await expect(lock).not.toContainText('Portage side not known yet.')

  // The printed route sheet draws where to land.
  await page.goto('/plan/print?from=51.5395,-0.9010&to=51.5470,-0.8740')
  const row = page.getByTestId('print-stops').locator('tr', { hasText: 'Hambleden Lock' })
  await expect(row.getByTestId('portage-drawing')).toBeVisible({ timeout: 15_000 })
})
