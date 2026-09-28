import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'Guide', template: '%s · paddlesnitch' },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
