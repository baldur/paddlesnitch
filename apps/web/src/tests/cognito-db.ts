import { readFile } from 'fs/promises'
import { join } from 'path'

// Reads the OTP code the lambda-emulator wrote for a particular email after
// a Custom Auth challenge was created. Retries a few times to dodge the
// race between "API returned the session" and "lambda finished writing file."
export async function readOtpCode(email: string): Promise<string | null> {
  const dir = process.env.LOCAL_OTP_DIR
  if (!dir) return null
  const filename = join(dir, encodeURIComponent(email))
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const raw = await readFile(filename, 'utf8')
      if (raw.trim()) return raw.trim()
    } catch {}
    await new Promise(r => setTimeout(r, 25))
  }
  return null
}

// Reads the most recent ConfirmationCode stored for a user in the test
// cognito-local db. Real Cognito never returns codes; cognito-local stores
// them on the user record so tests can simulate "user got the email."
//
// Relies on COGNITO_LOCAL_DB_DIR being set by global-setup.ts.
export async function readConfirmationCode(email: string): Promise<string | null> {
  const dbDir = process.env.COGNITO_LOCAL_DB_DIR
  const poolId = process.env.COGNITO_USER_POOL_ID
  if (!dbDir || !poolId) return null

  const dbPath = join(dbDir, '.cognito', 'db', `${poolId}.json`)
  // The test cognito-local writes this file whole and in order
  // (cognito-serial-writes.mjs, #901), and answers only after its write is
  // done, so the first read normally finds the code; the retries are only a
  // margin. Without the preload, overlapping writes left the file half-written
  // for seconds at a time and these reads found no code. Don't paper over a
  // missing code by waiting longer: find out why the file was wrong.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const raw = await readFile(dbPath, 'utf8')
      if (raw.trim()) {
        const db = JSON.parse(raw) as {
          Users?: Record<string, { Attributes?: Array<{ Name: string; Value: string }>; ConfirmationCode?: string }>
        }
        for (const u of Object.values(db.Users ?? {})) {
          const userEmail = u.Attributes?.find(a => a.Name === 'email')?.Value
          if (userEmail === email && u.ConfirmationCode) return u.ConfirmationCode
        }
      }
    } catch {
      // fall through to the retry sleep
    }
    await new Promise(r => setTimeout(r, 50))
  }
  return null
}
