import type { Metadata } from 'next'

// The profile pages' title. (Account settings move to /account; see
// docs/features/sitemap.md.)
export const metadata: Metadata = {
  title: 'Profile',
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
