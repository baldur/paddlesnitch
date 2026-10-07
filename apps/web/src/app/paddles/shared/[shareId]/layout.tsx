import type { Metadata } from 'next'
import { getSharedSession } from '@paddlesnitch/analysis/analysis-store'
import { fmtDay } from '@paddlesnitch/core/format'

// A shared paddle's own title ("4.2 km paddle on 13 Sep 2026"), for the tab
// and for the link preview where it's posted. It used to inherit "Paddles".
// Only what the shared page shows anyway: distance and date. A missing or
// stopped link gets the plain title (never says whether it existed).
export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params
  const s = await getSharedSession(shareId).catch(() => null)
  if (!s) return { title: 'A shared paddle' }
  const title = `${s.result.distanceKm.toFixed(1)} km paddle on ${fmtDay(s.paddledAt)}`
  return { title, openGraph: { title: `${title} · paddlesnitch` } }
}

export default function SharedPaddleLayout({ children }: { children: React.ReactNode }) {
  return children
}
