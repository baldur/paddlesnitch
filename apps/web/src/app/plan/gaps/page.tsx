import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import Gaps from '@/components/plan/Gaps'

// GAPS (docs/features/waterways-uk-ireland.md, "Being open about gaps"): every
// navigation and sizeable river, what we know about it, and what's missing.
export const metadata: Metadata = {
  title: 'Gaps',
  description: 'Every river and canal we cover in the UK and Ireland, what we know about it, and what paddlers could add.',
}

export default function GapsPage() {
  return (
    <>
      <AppHeader />
      <Gaps />
    </>
  )
}
