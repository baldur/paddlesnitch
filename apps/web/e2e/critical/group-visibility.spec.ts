import { test, expect } from '@playwright/test'
import {
  signUpFlow,
  createGroupViaApi,
  createCourseViaApi,
  signOut,
} from '../helpers'

// Critical path #4 of 5: a course scoped to a group is hidden from
// non-members.
//
// Permission-matrix coverage is in vitest (src/lib/permissions.test.ts
// + src/tests/groups.test.ts) — this spec just confirms the gate
// actually plumbs through to the rendered Server Component. The
// failure mode we're guarding against is "permission helper says no
// but page still renders" (or the inverse).
//
// We test the unauthenticated case here. Wiring a second signed-in
// user would add the "non-member can't see" case too, but at the cost
// of double the runtime — happy to add it if a regression slips
// through this one.

test('a group-scoped course returns 404 to an unauthenticated visitor', async ({ page }) => {
  await signUpFlow(page, { displayName: 'Group Owner' })

  // Create the group, then a course scoped to it. The owner-creator is
  // automatically a member, so they CAN view it.
  const group = await createGroupViaApi(page, { name: 'Owner Only Group' })
  const course = await createCourseViaApi(page, {
    name: 'Members Only Course',
    visibility: 'group',
    groupId: group.id,
  })

  // Sanity: the owner can see the detail page right now.
  await page.goto(`/att/courses/${course.id}`)
  await expect(page.getByRole('heading', { name: new RegExp(course.name.toUpperCase()) })).toBeVisible()

  // Now drop the session. The detail page should 404 — same response
  // as a missing course, so existence isn't leaked.
  await signOut(page)
  const res = await page.goto(`/att/courses/${course.id}`)
  expect(res?.status()).toBe(404)
})
