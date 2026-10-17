'use client'
import { useRef, useState } from 'react'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { formatTime } from '@/lib/geo'
import type { Line, CourseType } from '@/lib/types'
import { prepareTraceUpload, uploadErrorMessage } from '@/lib/trace-upload'

// Organiser tool (#71): upload a reference GPS trace and check it matches the
// course geometry being drawn — especially gate directions. Validation only;
// nothing is stored. Shown for gate courses once at least 2 gates are drawn.
type Geometry = {
  type: CourseType
  startLine?: Line
  finishLine?: Line
  gates?: Array<{ line: Line; direction: 1 | -1 }>
  gateDirection?: 1 | -1
  minValidSeconds?: number
}

type Result = { matched: boolean; totalElapsedSeconds?: number; message?: string }

export default function ReferenceTraceValidator({ geometry }: { geometry: Geometry }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'validating'>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  const validate = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { setError('Choose a GPS file first.'); return }
    setStatus('validating'); setError(''); setResult(null)
    try {
      const form = new FormData()
      form.append('file', await prepareTraceUpload(file))
      form.append('geometry', JSON.stringify(geometry))
      const res = await fetch('/att/api/courses/validate-trace', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(uploadErrorMessage(res.status, data, 'Couldn’t check that file. Please try again.'))
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t check that file. Please try again.')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-surface p-4">
      <h3 className="text-sm font-medium text-fg">Check with a reference trace (optional)</h3>
      <p className="text-sm text-muted">
        Upload a GPS trace of the course paddled correctly. We check it crosses every
        gate in order and the right way, so a gate pointing the wrong way shows up
        before anyone races. Nothing is saved.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor="reference-trace" className="sr-only">Reference trace</label>
        <input
          id="reference-trace"
          ref={fileRef}
          type="file"
          accept=".gpx,.fit,.csv"
          className="min-h-11 rounded-control bg-bg border border-border-strong px-3 py-2 text-fg text-sm file:rounded-control file:bg-surface-2 file:text-fg file:border-0 file:px-3 file:py-1 file:mr-3 file:text-sm file:cursor-pointer cursor-pointer flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={validate}
          disabled={status === 'validating'}
          className={buttonClass('secondary', 'md', 'shrink-0')}
        >
          {status === 'validating' ? 'Checking…' : 'Check trace'}
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-red text-sm">{error}</p>
      )}
      {result?.matched && (
        <p className="rounded-control border border-green/50 bg-green/10 px-3 py-2 text-green text-sm">
          ✓ This trace passes every gate correctly{result.totalElapsedSeconds != null ? ` (${formatTime(result.totalElapsedSeconds)})` : ''}. Your gates and directions look right.
        </p>
      )}
      {result && !result.matched && (
        <p className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-red text-sm">
          ✗ {result.message ?? 'This trace did not pass through the course as drawn.'}
        </p>
      )}
    </div>
  )
}
