import { test, expect } from '@playwright/test'
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

  await annCtx.close(); await bobCtx.close()
})
