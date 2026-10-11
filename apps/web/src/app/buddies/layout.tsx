import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Buddies' }

export default function BuddiesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
