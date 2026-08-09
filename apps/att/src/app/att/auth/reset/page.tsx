'use client'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Step 2 of password reset: user pastes the emailed code + picks a new password.
function ResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Derive directly — see CLAUDE.md (useSearchParams anti-pattern note).
  const presetEmail = searchParams.get('email') ?? ''

  const [email, setEmail] = useState(presetEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/att/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not reset password')
      // Server auto-signs the user in if it can; if it couldn't, send to login.
      if (data?.signedIn) router.push('/att')
      else router.push('/att/auth?reset=ok')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password')
      setLoading(false)
    }
  }

  const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-sm tracking-widest text-fg mb-2">SET NEW PASSWORD</h1>
      <p className="text-xs text-muted mb-6">
        Paste the 6-digit code from your email and choose a new password.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted tracking-widest">EMAIL</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted tracking-widest">CODE FROM EMAIL</label>
          <input
            type="text"
            required
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value)}
            className={`${inputClass} tracking-widest`}
            placeholder="000000"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted tracking-widest">NEW PASSWORD</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-muted">
            Minimum 8 characters — must include an uppercase letter, a lowercase letter, and a number.
          </p>
        </div>
        {error && (
          <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 transition-colors"
        >
          {loading ? 'RESETTING…' : 'RESET PASSWORD'}
        </button>
        <p className="text-xs text-muted text-center">
          Didn&apos;t get a code?{' '}
          <Link href="/att/auth/forgot" className="tt-link">Request another</Link>
        </p>
      </form>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-4 py-3">
        <Link href="/att">
          <span className="text-fg font-bold text-lg tracking-widest">ATT</span>
        </Link>
      </header>
      <div className="flex-1 flex items-start justify-center pt-16 px-4">
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  )
}
