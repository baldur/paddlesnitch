import Link from 'next/link'
import { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'

// Site footer. Always visible on /att/* pages. Provides discoverability for
// the privacy policy and surfaces the controller identity at a glance.
const link = 'tt-nav-link inline-flex items-center min-h-11 sm:min-h-0'

export default function Footer() {
  return (
    <footer className="border-t border-border px-4 py-4 text-sm text-muted flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div>
        © {new Date().getFullYear()} paddlesnitch.com
      </div>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
        <Link href="/help" className={link}>Help</Link>
        <Link href="/guide" className={link}>Tracker guide</Link>
        <Link href="/privacy" className={link}>Privacy</Link>
        <Link href="/terms" className={link}>Terms</Link>
        <Link href="/account" className={link}>Account</Link>
        <ReportIssueButton className={link} />
      </nav>
    </footer>
  )
}
