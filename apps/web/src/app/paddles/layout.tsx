import type { Metadata } from 'next'

// The Paddles section's title and description. The root layout owns
// <html>/<body>/font/globals/footer.
export const metadata: Metadata = {
  title: { default: 'Paddles', template: '%s · paddlesnitch' },
  description: 'Speed, stroke rate, rests, wind and river flow for every paddle, plus a diary.',
}

export default function PaddlesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
