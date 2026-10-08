'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useMountedAt } from '@/lib/use-mounted-at'

// The beta tester application form. Posts to /api/beta-signup with the same
// invisible bot checks as the other public forms (a hidden `website` field and
// the time since the form was shown).

const SPORTS = [
  ['kayak', 'Kayak'], ['single-scull', 'Single scull'], ['crew-rowing', 'Crew rowing'], ['sup', 'Paddleboard (SUP)'], ['canoe', 'Canoe'],
] as const
const FREQUENCIES = [
  ['most-weeks', 'Most weeks'], ['few-a-month', 'A few times a month'], ['now-and-then', 'Now and then'],
] as const

const field = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'
const label = 'text-xs text-muted tracking-widest uppercase'

export default function BetaSignupForm() {
  const mountedAt = useMountedAt()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [sport, setSport] = useState('')
  const [frequency, setFrequency] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      const res = await fetch('/api/beta-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, sport, frequency, website, elapsedMs: Date.now() - mountedAt.current }),
      })
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? 'Couldn’t send your application. Please try again.')
        setStatus('idle')
        return
      }
      setStatus('done')
    } catch {
      setError('Couldn’t send your application. Please check your connection and try again.')
      setStatus('idle')
    }
  }

  if (status === 'done') {
    return (
      <p className="text-sm text-green" role="status">
        Thanks, {name.split(' ')[0] || 'paddler'}. We’ll be in touch.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={label}>Name</span>
        <input required autoFocus value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={100} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Email</span>
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={200} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>How do you paddle?</span>
        <select required value={sport} onChange={e => setSport(e.target.value)} className={field}>
          <option value="" disabled>Choose one</option>
          {SPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>How often are you on the water?</span>
        <select required value={frequency} onChange={e => setFrequency(e.target.value)} className={field}>
          <option value="" disabled>Choose one</option>
          {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      {error && <p className="border border-red bg-red/10 px-3 py-2 text-red text-xs" role="alert">{error}</p>}

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          We’ll be in touch. We only use this to choose and contact beta testers.{' '}
          <Link href="/privacy" className="tt-link">Privacy policy</Link>.
        </p>
        <button type="submit" disabled={status === 'sending'}
          className="w-full px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:opacity-90 disabled:opacity-50 transition-opacity">
          {status === 'sending' ? 'SENDING…' : 'SIGN ME UP'}
        </button>
      </div>
    </form>
  )
}
