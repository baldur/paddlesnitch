'use client'
import { useRef, useState } from 'react'
import { formatTime } from '@/lib/geo'
import type { Line, CourseType } from '@/lib/types'

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
      form.append('file', file)
      form.append('geometry', JSON.stringify(geometry))
      const res = await fetch('/att/api/courses/validate-trace', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Validation failed')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border bg-surface p-4">
      <label className="text-xs text-muted tracking-widest">VALIDATE WITH A REFERENCE TRACE (OPTIONAL)</label>
      <p className="text-xs text-muted">
        Upload a GPS trace of the course paddled correctly. We&apos;ll check it crosses
        every gate in the right order and direction — a quick way to catch a gate
        pointing the wrong way before anyone races. Nothing is saved.
      </p>
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".gpx,.fit,.csv"
          className="bg-bg border border-border px-3 py-2 text-fg text-sm file:bg-surface-2 file:text-fg file:border-0 file:px-3 file:py-1 file:mr-3 file:text-xs file:cursor-pointer cursor-pointer flex-1"
        />
        <button
          type="button"
          onClick={validate}
          disabled={status === 'validating'}
          className="px-4 py-2 bg-primary text-white text-xs tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {status === 'validating' ? 'CHECKING…' : 'VALIDATE'}
        </button>
      </div>
      {error && (
        <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">{error}</div>
      )}
      {result?.matched && (
        <div className="border border-green bg-green/10 px-3 py-2 text-green text-xs">
          ✓ This trace passes every gate correctly{result.totalElapsedSeconds != null ? ` (${formatTime(result.totalElapsedSeconds)})` : ''}. Your gates and directions look right.
        </div>
      )}
      {result && !result.matched && (
        <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
          ✗ {result.message ?? 'This trace did not pass through the course as drawn.'}
        </div>
      )}
    </div>
  )
}
