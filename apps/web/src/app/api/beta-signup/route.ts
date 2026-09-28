import { NextResponse } from 'next/server'
import { looksLikeBot } from '@/lib/anti-bot'
import { parseBetaApplication, saveBetaApplication } from '@/lib/beta-signups'
import { sendEmail } from '@/lib/email'

// Beta tester applications from the ?campaign=betatesters landing. Public:
// the applicant usually has no account. Outside /att/api and /api/account, so
// the proxy's mutation auth-gate never applies (see proxy.test.ts).
//
// Same zero-friction bot gate as the other public forms: a positive result is
// dropped silently with a success-looking reply.

// Where new applications are announced. privacy@ is already forwarded to the
// owner's inbox by the SES receipt rule, so no new address or config is needed.
const NOTIFY_TO = process.env.BETA_NOTIFY_TO ?? 'privacy@paddlesnitch.com'

const SPORT_LABEL: Record<string, string> = { kayak: 'Kayak', 'single-scull': 'Single scull', 'crew-rowing': 'Crew rowing', sup: 'Paddleboard (SUP)', canoe: 'Canoe' }
const FREQ_LABEL: Record<string, string> = { 'most-weeks': 'Most weeks', 'few-a-month': 'A few times a month', 'now-and-then': 'Now and then' }

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (looksLikeBot(body)) return NextResponse.json({ ok: true })

  const parsed = parseBetaApplication(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { record: saved, repeat } = await saveBetaApplication(parsed.app)

  // Best effort: the application is saved, so a failed notification must not
  // turn into an error for the applicant.
  await sendEmail({
    to: NOTIFY_TO,
    subject: `${repeat ? 'Updated' : 'New'} beta tester application: ${saved.name}`,
    text: [
      `Name: ${saved.name}`,
      `Email: ${saved.email}`,
      `Paddles: ${SPORT_LABEL[saved.sport]}`,
      `How often: ${FREQ_LABEL[saved.frequency]}`,
      `Applied: ${saved.appliedAt}${repeat ? ` (updated ${saved.updatedAt})` : ''}`,
    ].join('\n'),
  }).catch(() => false)

  return NextResponse.json({ ok: true })
}
