import type { Metadata } from 'next'

// The Trials section's title (the URL keeps its historical /att prefix).
export const metadata: Metadata = {
  title: { default: 'Trials', template: '%s · paddlesnitch' },
  description: 'River time trials timed from your GPS file: start and finish lines on a map, 500 m splits, leaderboards.',
}

export default function TrialsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
