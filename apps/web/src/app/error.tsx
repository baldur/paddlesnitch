'use client'
import { useEffect } from 'react'
import AppHeader from '@/components/AppHeader'
import { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'

// Shown when a page throws while rendering, in place of Next's own error
// screen. The message stays generic; the error goes to the console.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <div className="flex-1 px-4 py-16 max-w-xl mx-auto w-full flex flex-col gap-4">
        <h1 className="text-lg font-bold text-balance">Something went wrong on this page</h1>
        <p className="text-sm text-muted leading-relaxed">
          Try again. If it keeps happening, report it and say what you were doing.
        </p>
        <div className="flex flex-wrap gap-3 mt-2">
          <button onClick={reset} className="px-4 py-3 bg-primary text-white text-sm font-bold">Try again</button>
          <ReportIssueButton className="px-4 py-3 border border-border text-fg text-sm" />
        </div>
      </div>
    </main>
  )
}
