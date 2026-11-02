'use client'
import Link from 'next/link'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'

// While we can't email reset codes (lib/email-delivery.ts), both reset pages
// say so plainly and offer the way that works instead of a code that never
// arrives.
export default function NoEmailReset() {
  return (
    <Page width="narrow" className="max-w-md">
      <PageHeader title="Reset your password" />
      <div className="flex flex-col gap-4">
        <p className="text-base text-muted">
          We can&apos;t email reset codes yet. Report an issue with the email you signed up with, and we&apos;ll reset your password for you.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <ReportIssueButton className={buttonClass('primary')} />
          <Link href="/signin" className={buttonClass('secondary')}>Back to sign in</Link>
        </div>
      </div>
    </Page>
  )
}
