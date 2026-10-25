'use client'
import { useEffect } from 'react'
import AppHeader from '@/components/AppHeader'
import { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { reportClientError } from '@paddlesnitch/ui/analytics'

// Shown when a page throws while rendering, in place of Next's own error
// screen. The message stays generic; the error goes to the console and, as a
// client_error, to us (React catches it here, so window's error event never
// sees it).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); reportClientError(error.name || 'RenderError', error.message) }, [error])
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
