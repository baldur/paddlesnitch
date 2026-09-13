import type { ReactNode } from 'react'
import AppShell from '@paddlesnitch/ui/AppShell'
import AttAccountNav from '@/components/AttAccountNav'

// att's page header — now a thin wrapper over the shared platform AppShell so att
// and Analyse share ONE header (brand + cross-app Trials↔Analyse nav + REPORT +
// account). The per-page API is unchanged (`breadcrumb` + optional nav
// `children`), so all ~17 callers keep working; the shell supplies the account
// nav (AttAccountNav) and the REPORT trigger (opens the shared FeedbackWidget via
// a window event).
export default function AppHeader({
  breadcrumb,
  children,
}: {
  breadcrumb: ReactNode
  children?: ReactNode
}) {
  return (
    <AppShell active="att" breadcrumb={breadcrumb} nav={children} account={<AttAccountNav />} />
  )
}
