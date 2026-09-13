// Lightweight, zero-friction bot deterrents for unauthenticated POST endpoints
// that send email or create content (OTP sign-in, password reset, feedback).
//
// Two invisible checks, neither of which a real user ever notices:
//   - honeypot: a hidden form field that real users never see or fill, but
//     naive form-scraping bots populate.
//   - time trap: a human takes more than MIN_ELAPSED_MS between the form being
//     shown and submitting it; an instant submit is a bot replaying the form.
//
// These only stop unsophisticated bots — a script POSTing JSON straight at the
// route omits both fields trivially. They are a cheap first line, not a
// guarantee. Treat a positive result as "drop silently": the caller should
// return a success-looking response so the bot gets no signal to adapt, and
// crucially should NOT do the expensive/side-effecting work (send the email,
// create the Cognito user, file the issue).

export const MIN_ELAPSED_MS = 2000

export type AntiBotFields = {
  website?: unknown   // honeypot — must come back empty
  elapsedMs?: unknown // ms between the form being shown and submitted
}

export function looksLikeBot(body: AntiBotFields): boolean {
  const honeypot = typeof body.website === 'string' ? body.website.trim() : ''
  const elapsedMs = typeof body.elapsedMs === 'number' ? body.elapsedMs : 0
  return honeypot.length > 0 || elapsedMs < MIN_ELAPSED_MS
}
