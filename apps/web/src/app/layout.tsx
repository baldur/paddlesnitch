import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import './globals.css'
import Footer from '@/components/Footer'
import CookieNotice from '@/components/CookieNotice'
import FeedbackWidget from '@paddlesnitch/ui/FeedbackWidget'
import AttContactBanner from '@/components/AttContactBanner'
import Analytics from '@/components/Analytics'
import TRPCProvider from '@/components/TRPCProvider'
import { SessionUserProvider } from '@/components/SessionUser'
import { sessionUser } from '@/lib/session-user'

// Sans for reading and controls, Mono for numbers and small labels (tokens.css).
const plexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-sans',
})
const plexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  // Sections and pages set a short title ("Trials", "Privacy policy"); the
  // template adds the site name. A page with no title of its own gets the default.
  title: { default: 'paddlesnitch', template: '%s · paddlesnitch' },
  description: 'Time trials and paddle analysis for kayakers and rowers.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1220',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await sessionUser()
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      {/* Bottom padding on phones makes room for the bottom tab bar (AppShell). */}
      <body className="min-h-screen flex flex-col bg-bg text-fg pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
        <TRPCProvider>
          <SessionUserProvider user={user}>
          <AttContactBanner />
          {children}
          <Footer />
          <CookieNotice />
          <FeedbackWidget />
          <Analytics />
          </SessionUserProvider>
        </TRPCProvider>
      </body>
    </html>
  )
}
