import { cookies } from 'next/headers'
import { getAuthUser } from '@/lib/auth'
import { REFRESH_COOKIE } from '@paddlesnitch/core/auth'
import type { NavUser } from '@paddlesnitch/ui/AccountNav'

/**
 * The signed-in user for the header, read once with the page (#411). Only what
 * the header shows: id and name. Undefined when a session cookie is there but
 * couldn't be confirmed here (the header then asks, as before), so a passing
 * hiccup never shows a signed-in paddler as signed out.
 */
export async function sessionUser(): Promise<NavUser | null | undefined> {
  const user = await getAuthUser().catch(() => null)
  if (user) return { id: user.id, displayName: user.displayName }
  return (await cookies()).get(REFRESH_COOKIE) ? undefined : null
}
