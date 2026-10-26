// Email + password sign-up is two calls since #702: signup sends a code, and
// signup/confirm takes it and signs in. This does both, reading the code from
// cognito-local's database, and answers with confirm's response (or signup's,
// when signup refused).
import { NextRequest } from 'next/server'
import { POST as signup } from '@/app/att/api/auth/signup/route'
import { POST as confirm } from '@/app/att/api/auth/signup/confirm/route'
import { readConfirmationCode } from './cognito-db'

type Body = { email: string; displayName: string; password: string; acceptedTosVersion: string }

const post = (path: string, body: unknown, app: boolean) => new NextRequest(`http://x${path}`, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(app ? { 'x-paddlesnitch-app': 'android/0.1.0' } : {}) },
})

export async function signUpConfirmed(body: Body, opts: { app?: boolean } = {}): Promise<Response> {
  const started = await signup(post('/att/api/auth/signup', body, !!opts.app))
  if (started.status !== 202) return started
  const code = await readConfirmationCode(body.email)
  if (!code) throw new Error('no sign-up code in cognito-local')
  return confirm(post('/att/api/auth/signup/confirm', {
    email: body.email, code, password: body.password, acceptedTosVersion: body.acceptedTosVersion,
  }, !!opts.app))
}
