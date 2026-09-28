import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'Devices', template: '%s · paddlesnitch' },
}

export default function DevicesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
