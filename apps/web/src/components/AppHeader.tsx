'use client'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import AppShell, { sectionFor } from '@paddlesnitch/ui/AppShell'
import AttAccountNav from '@/components/AttAccountNav'

// The page header used by every page outside /paddles: the shared AppShell with
// the account menu wired in. The highlighted tab comes from the URL, so a page
// that is in neither section (home, profile, account, devices, legal) lights up
// neither tab. It used to pass "att" always, so TRIALS was lit everywhere.
export default function AppHeader({
  breadcrumb,
  children,
}: {
  breadcrumb: ReactNode
  children?: ReactNode
}) {
  const pathname = usePathname() ?? ''
  return (
    <AppShell active={sectionFor(pathname)} breadcrumb={breadcrumb} nav={children} account={<AttAccountNav />} />
  )
}
