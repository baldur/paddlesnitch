import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'Plan', template: '%s · paddlesnitch' },
  description: 'Plan a paddle on a river or canal: every portage, crew point and arrival time between two clicks.',
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
