import { createHash } from 'crypto'
import { getJson, putJson, deleteObject } from './storage'

// Beta tester applications from the ?campaign=betatesters landing.
//
// One record per email address, keyed by its sha256 so a bucket listing doesn't
// expose addresses and a repeat application updates the first instead of piling
// up. Personal data: account erasure deletes the record for the account's email
// and export includes it; someone without an account asks by email.

// In the order the form lists them.
export const BETA_SPORTS = ['kayak', 'single-scull', 'crew-rowing', 'sup', 'canoe'] as const
export const BETA_FREQUENCIES = ['most-weeks', 'few-a-month', 'now-and-then'] as const

export type BetaApplication = {
  name: string
  email: string
  sport: (typeof BETA_SPORTS)[number]
  frequency: (typeof BETA_FREQUENCIES)[number]
  appliedAt: string
  updatedAt: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Pure: turn a submitted body into an application, or say what's wrong in words
// a person can act on.
export function parseBetaApplication(
  body: Record<string, unknown>,
): { ok: true; app: Omit<BetaApplication, 'appliedAt' | 'updatedAt'> } | { ok: false; error: string } {
  const name = str(body.name, 100)
  const email = str(body.email, 200).toLowerCase()
  const sport = str(body.sport, 20)
  const frequency = str(body.frequency, 20)
  if (!name) return { ok: false, error: 'Please enter your name.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' }
  if (!(BETA_SPORTS as readonly string[]).includes(sport)) return { ok: false, error: 'Please choose how you paddle.' }
  if (!(BETA_FREQUENCIES as readonly string[]).includes(frequency)) return { ok: false, error: 'Please choose how often you get out on the water.' }
  return {
    ok: true,
    app: {
      name, email,
      sport: sport as BetaApplication['sport'],
      frequency: frequency as BetaApplication['frequency'],
    },
  }
}

const keyFor = (email: string) =>
  `beta-signups/${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}.json`

// Save (or update) an application. Keeps the original appliedAt. `repeat` says
// whether this email had applied before (not inferred from timestamps, which
// can be equal when two applications land in the same millisecond).
export async function saveBetaApplication(
  app: Omit<BetaApplication, 'appliedAt' | 'updatedAt'>,
): Promise<{ record: BetaApplication; repeat: boolean }> {
  const now = new Date().toISOString()
  const prev = await getJson<BetaApplication>(keyFor(app.email))
  const record: BetaApplication = { ...app, appliedAt: prev?.appliedAt ?? now, updatedAt: now }
  await putJson(keyFor(app.email), record)
  return { record, repeat: prev !== null }
}

export async function getBetaApplication(email: string): Promise<BetaApplication | null> {
  return getJson<BetaApplication>(keyFor(email))
}

export async function eraseBetaApplication(email: string): Promise<void> {
  await deleteObject(keyFor(email))
}
