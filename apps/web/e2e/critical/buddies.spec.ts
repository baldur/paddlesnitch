import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'
import { signUpFlow } from '../helpers'

// Critical path: two paddlers become buddies through an invite link, each in
// their own browser (docs/features/buddies-and-compare.md).

test('an invite link makes two paddlers buddies, and each sees the other', async ({ browser }) => {
  const annCtx = await browser.newContext(), bobCtx = await browser.newContext()
  const ann = await annCtx.newPage(), bob = await bobCtx.newPage()

  await signUpFlow(ann, { displayName: 'Ann Invites' })
  await ann.goto('/buddies')
  await expect(ann.getByText('No buddies yet')).toBeVisible()
  const link = ann.locator('section[aria-label="Your invite link"] code')
  await expect(link).toContainText('/buddies?invite=')
  const url = new URL((await link.textContent())!)

  await signUpFlow(bob, { displayName: 'Bob Joins' })
  await bob.goto(url.pathname + url.search)
  await expect(bob.getByRole('status')).toContainText('You and Ann Invites are now buddies.')
  await expect(bob.locator('section[aria-label="Your buddies"]')).toContainText('Ann Invites')

  await ann.reload()
  await expect(ann.locator('section[aria-label="Your buddies"]')).toContainText('Bob Joins')

  // The link still works for Ann's next buddy, and opening it again changes nothing.
  await bob.goto(url.pathname + url.search)
  await expect(bob.getByRole('status')).toContainText('already buddies')

  // Ann adds a paddle; Bob finds it under her paddles and opens it.
  const added = await ann.request.post('/paddles/api/analyse', {
    multipart: { file: { name: 'garmin.zip', mimeType: 'application/zip', buffer: readFileSync(path.join(__dirname, '../../src/tests/fixtures/garmin-activity-export.zip')) } },
  })
  expect(added.ok()).toBe(true)
  await bob.goto('/buddies')
  await bob.locator('section[aria-label="Your buddies"]').getByRole('link', { name: 'PADDLES →' }).click()
  await expect(bob.getByRole('heading', { name: "ANN INVITES'S PADDLES" })).toBeVisible()
  await bob.locator('main a[href^="/buddies/"]').first().click()
  await expect(bob.getByRole('link', { name: "← ANN INVITES'S PADDLES" })).toBeVisible()
  await expect(bob.getByText('km').first()).toBeVisible()
  // A buddy can't edit or share it.
  await expect(bob.getByRole('button', { name: 'NOTES' })).toHaveCount(0)
  await expect(bob.getByRole('button', { name: 'SHARE' })).toHaveCount(0)

  // Bob compares one of his own paddles with Ann's: both lines on one map.
  const fixture = readFileSync(path.join(__dirname, '../../src/tests/fixtures/garmin-activity-export.zip'))
  // The same file, but Bob's own paddle: duplicates are found per person.
  expect((await bob.request.post('/paddles/api/analyse', { multipart: { file: { name: 'garmin.zip', mimeType: 'application/zip', buffer: fixture } } })).ok()).toBe(true)
  await bob.getByRole('button', { name: 'COMPARE WITH ONE OF MINE' }).click()
  await bob.locator('a[href*="/paddles/compare?"]').first().click()
  await expect(bob).toHaveURL(/bOwner=/)
  const water = bob.locator('section[aria-label="On the water"]')
  await expect(water).toContainText('You ·')
  await expect(water).toContainText('Ann Invites ·')
  await expect(bob.getByText(/NOTE ·/)).toHaveCount(0)   // never Ann's notes

  await annCtx.close(); await bobCtx.close()
})
