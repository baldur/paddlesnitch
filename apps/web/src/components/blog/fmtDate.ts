// "29 September 2026" from "2026-09-29", in UTC so the build machine's time
// zone can't shift a post to the day before.
export function fmtPostDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
