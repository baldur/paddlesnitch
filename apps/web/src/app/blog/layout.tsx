import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'Blog', template: '%s · paddlesnitch' },
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
