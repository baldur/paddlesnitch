import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { getProfileSettings } from '@/lib/profile'

// /profile/me — the signed-in paddler's own profile entry point. Redirects to
// their canonical public profile (/profile/{handle-or-id}), where the owner view
// shows a SETTINGS link (→ /profile/me/settings). Signed-out → sign in and come
// back here.
export default async function MyProfilePage() {
  const user = await getAuthUser()
  if (!user) redirect('/att/auth?next=/profile/me')
  const settings = await getProfileSettings(user.id)
  redirect(`/profile/${settings.handle ?? user.id}`)
}
