import type { Metadata } from 'next'

// Section layout for the Analyse app (now folded into the unified web app under
// /analyse). The root layout owns <html>/<body>/font/globals/footer; this only
// scopes the page title + description for the analyse routes.
export const metadata: Metadata = {
  title: 'Paddle Analysis — paddlesnitch',
  description: 'See what actually happened on your paddle — pieces, rests, stroke-rate, wind & flow — and keep a paddling diary.',
}

export default function AnalyseLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
