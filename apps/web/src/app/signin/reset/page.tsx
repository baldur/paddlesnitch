'use client'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { RESET_EMAIL } from '@/lib/email-delivery'
import NoEmailReset from '../NoEmailReset'

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
      if (!res.ok) throw new Error(data?.error ?? 'Couldn’t reset your password. Please try again.')
      // Server auto-signs the user in if it can; if it couldn't, send to login.
      if (data?.signedIn) router.push('/')
      else router.push('/signin?reset=ok')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t reset your password. Please try again.')
      setLoading(false)
    }
  }

  if (!RESET_EMAIL) return <NoEmailReset />

  return (
    <Page width="narrow" className="max-w-md">
      <PageHeader title="Set a new password" description="Paste the 6-digit code from your email and choose a new password." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="reset-email">
          <input
            id="reset-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Code from the email" htmlFor="reset-code">
          <input
            id="reset-code"
            type="text"
            required
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value)}
            className={`${inputClass} tabular`}
            placeholder="000000"
          />
        </Field>
        <Field label="New password" htmlFor="reset-password" help="At least 8 characters, with an uppercase letter, a lowercase letter and a number.">
          <input
            id="reset-password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
        )}
        <button type="submit" disabled={loading} className={buttonClass('primary', 'md', 'w-full')}>
          {loading ? 'Resetting…' : 'Reset password'}
        </button>
        <p className="text-sm text-muted text-center">
          Didn&apos;t get a code? <Link href="/signin/forgot" className="tt-link">Request another</Link>
          {' · '}
          <Link href="/signin" className="tt-link">Back to sign in</Link>
        </p>
      </form>
    </Page>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  )
}
