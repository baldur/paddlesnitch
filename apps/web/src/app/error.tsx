'use client'
import { useEffect } from 'react'
import AppHeader from '@/components/AppHeader'
import { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'

// Shown when a page throws while rendering, in place of Next's own error
// screen. The message stays generic; the error goes to the console.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <Page width="narrow">
        <PageHeader
          title="Something went wrong on this page"
          description="Try again. If it keeps happening, report it and say what you were doing."
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reset} className={buttonClass('primary')}>Try again</button>
          <ReportIssueButton className={buttonClass('secondary')} />
        </div>
      </Page>
    </main>
  )
}
