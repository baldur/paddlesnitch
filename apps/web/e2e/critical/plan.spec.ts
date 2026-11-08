import { test, expect, type Locator } from '@playwright/test'
import { signUpFlow } from '../helpers'

// Critical path: plan a paddle by clicking the water, and open a plan from a
// link. No account needed (docs/features/river-planner.md).

test('two clicks on the water give a route and its stops', async ({ page }) => {
  // Centred on the Kennet where it meets the Thames at Reading.
  const settled = page.waitForResponse(r => /\/area-/.test(r.url()))   // the map has moved to this view
  await page.goto('/plan?view=51.4566,-0.9581,15')
  await settled
  const map = page.locator('.leaflet-container')
  await expect(map).toBeVisible()
  await expect(page.getByText('Click the water to set your start.')).toBeVisible({ timeout: 15_000 })
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText('Now click the water where you finish.')).toBeVisible()
  await page.mouse.click(box.x + box.width / 2 + 250, box.y + box.height / 2 - 60)

  await expect(page.getByTestId('plan-summary')).toContainText('Distance')
  await expect(page.getByTestId('stop-list')).toContainText('Added by paddlesnitch survey')   // Blakes Lock's surveyed carry
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
  // On a return trip the far end is where you turn back, not a finish (#630).
  await page.getByRole('button', { name: 'Return' }).click()
  await expect(page.getByRole('combobox', { name: 'Turn at' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Finish' })).toHaveCount(0)
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
  const box = page.getByLabel('Find a place on the map')
  await box.click()
  await box.fill('marsh lo')
  await page.getByRole('option', { name: /^Marsh Lock/ }).click()
  await expect(box).toHaveValue('Marsh Lock')
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test('the plan survives a trip to the crew sheet and back (#629)', async ({ page }) => {
  await page.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667')
  await expect(page.getByTestId('plan-summary')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Return' }).click()   // changes the plan after the page loaded
  await expect(page).toHaveURL(/shape=return/)
  await page.getByRole('link', { name: 'Crew sheet' }).click()
  await expect(page).toHaveURL(/\/plan\/print/)
  await page.goBack()
  await expect(page).toHaveURL(/shape=return/)
  await expect(page.getByRole('button', { name: 'Return' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('plan-summary')).toBeVisible()
})

// The DW fixture is rebuilt from live OSM, so its length moves by a few
// hundred metres between rebuilds: check the whole route, not the decimal.
const DW_KM = /201\.\d km/
const kmIn = async (l: Locator) => Number((await l.innerText()).match(/(\d+\.\d) km/)?.[1])

test('a plan link opens the whole Devizes to Westminster route', async ({ page }) => {
  await page.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667')
  const summary = page.getByTestId('plan-summary')
  await expect(summary).toContainText(DW_KM, { timeout: 15_000 })
  await expect(summary).toContainText('78')  // 77 locks, less Ufton (paddled through), plus two low bridges
  await expect(page.getByTestId('stop-list')).toContainText('Teddington Lock')
  const oneWay = await kmIn(summary)
  await page.getByRole('button', { name: 'Return' }).click()
  // There and back is twice the way, give or take the rounding of each.
  await expect.poll(async () => Math.abs((await kmIn(summary)) - 2 * oneWay)).toBeLessThanOrEqual(0.1)
  await expect(page.getByTestId('stop-list')).toContainText(/Turn at/)
})

test('a saved, shared plan opens from its link for someone signed out', async ({ browser }) => {
  const ownerCtx = await browser.newContext(), guestCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  await signUpFlow(owner, { displayName: 'Plan Owner' })
  await owner.goto('/plan?from=51.355333,-1.994961&to=51.500833,-0.121667')
  await expect(owner.getByTestId('plan-summary')).toContainText(DW_KM, { timeout: 15_000 })
  await owner.getByLabel('Plan name').fill('DW crew plan')
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(owner).toHaveURL(/\/plan\/(?!shared)[^/?]+$/, { timeout: 15_000 })

  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const link = (await owner.getByTestId('share-link').innerText()).trim()
  expect(link).toMatch(/\/plan\/shared\/[\w-]+$/)

  const guest = await guestCtx.newPage()
  await guest.goto(new URL(link).pathname)
  await expect(guest.getByText('Shared by Plan Owner.', { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(guest.getByTestId('plan-summary')).toContainText(DW_KM)

  await owner.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(owner.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await guest.reload()
  await expect(guest.getByText("We can't find this plan", { exact: false })).toBeVisible()
  await ownerCtx.close(); await guestCtx.close()
})

test('a portage has its own page: what we know, on the satellite map, and only the drawing in print', async ({ page }) => {
  await page.goto('/plan/portage/crt%3Alocks%3AKA-013-009')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tyle Mill')
  const details = page.getByTestId('portage-landings')
  await expect(details).toContainText('get out on your right')
  await expect(details).toContainText('Seen 8 Nov 2026')
  await expect(page.locator('img.leaflet-tile[src*="World_Imagery"]').first()).toBeAttached()
  await expect(page.getByTestId('portage-drawing').first()).toBeVisible()

  // Esri's imagery may not be printed; the drawing is ours.
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('portage-satellite')).toBeHidden()
  await expect(page.getByTestId('portage-drawing').first()).toBeVisible()
})

test('a portage marker opens a card on a tap, without placing a route end', async ({ page }) => {
  const TYLE_MILL = '51.418526,-1.100565'
  const markers = page.waitForResponse(r => /\/portages-/.test(r.url()))
  await page.goto(`/plan?view=${TYLE_MILL},16`)
  await markers
  const box = (await page.locator('.leaflet-container').boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.waitForTimeout(300)

  // A near miss still counts: a fingertip isn't a pixel.
  await page.mouse.click(centre.x + 14, centre.y)
  const card = page.locator('.portage-card')
  await expect(card).toContainText('Tyle Mill')
  await expect(card).toContainText('Landings described')
  await expect(card.getByRole('link', { name: 'Portage details' })).toHaveAttribute('href', /\/plan\/portage\/crt%3Alocks%3AKA-013-009/)
  await expect(page).not.toHaveURL(/from=/)

  // Tapping away closes the card and places nothing.
  await page.mouse.click(centre.x + 200, centre.y + 120)
  await expect(card).toHaveCount(0)
  await expect(page).not.toHaveURL(/from=/)
})

test('portage markers wait until you are zoomed in', async ({ page }) => {
  const asked: string[] = []
  page.on('request', r => { if (/\/portages-/.test(r.url())) asked.push(r.url()) })
  const settled = page.waitForResponse(r => /\/area-/.test(r.url()))
  await page.goto('/plan?view=51.4185,-1.1005,10')
  await settled
  await page.waitForTimeout(500)
  expect(asked).toEqual([])
})

test('portage markers are off while placing landings, so a tap lands on the water', async ({ page }) => {
  const asked: string[] = []
  page.on('request', r => { if (/\/portages-/.test(r.url())) asked.push(r.url()) })
  await page.goto('/plan?lock=crt%3Alocks%3AKA-013-009&lockAt=51.418526,-1.100565&lockName=Tyle%20Mill&view=51.418526,-1.100565,18')
  await expect(page.getByTestId('add-portage')).toBeVisible()
  // The link's view holds even though the address loses it before the map loads.
  await expect(page.locator('img.leaflet-tile[src*="/tile/18/"]').first()).toBeAttached()
  await page.waitForTimeout(500)
  expect(asked).toEqual([])
})

test('a plan links each portage to its page', async ({ page }) => {
  await page.goto('/plan?from=51.4190,-1.1000&to=51.4247,-1.0830')
  const link = page.getByTestId('portage-block').getByRole('link', { name: 'Portage details' }).first()
  await link.click()
  await expect(page).toHaveURL(/\/plan\/portage\//)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // "← Plan" brings the route back.
  await page.getByRole('link', { name: '← Plan' }).click()
  await expect(page).toHaveURL(/\/plan\?from=/)
})

test('an unknown portage is a 404, not a broken page', async ({ page }) => {
  expect((await page.goto('/plan/portage/no-such-lock'))?.status()).toBe(404)
  // Bad encoding: the dev server answers 400 before the page; a production build reaches it (a 404, unit-tested).
  expect((await page.goto('/plan/portage/%E0%A4%A'))?.status()).toBeLessThan(500)
  expect((await page.goto('/plan/portage/osm%3Alock%3Away%2F123'))?.status()).toBe(404)
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
  await panel.getByLabel('Release under CC0').check()
  await panel.getByRole('button', { name: 'Publish' }).click()

  await expect(panel).toHaveCount(0)
  await expect(lock).toContainText('Added by Lock Keeper', { timeout: 15_000 })
  await expect(lock).not.toContainText('Portage side not known yet.')

  // The printed route sheet draws where to land.
  await page.goto('/plan/print?from=51.5395,-0.9010&to=51.5470,-0.8740')
  const row = page.getByTestId('print-stops').locator('tr', { hasText: 'Hambleden Lock' })
  await expect(row.getByTestId('portage-drawing')).toBeVisible({ timeout: 15_000 })
})
