// The public GitHub issue for a portage note held for review. Pure. The issue is
// public and the note may be abuse, so the note, the author's name and their
// user id are out of reach of this code: it takes only the fields below, and
// the only text from the note is one the check has passed (verdict.bleeped).
import type { PortageContribution, PortageVerdict } from './portage'

export type HeldNote = Pick<PortageContribution, 'id' | 'at' | 'createdAt'>

const BUCKET = 'paddlesnitch-data-prod'
const MAX_SHOWN = 300

const WHY: Record<PortageVerdict['category'], string> = {
  racist: 'The check says it may be racist.',
  sexist: 'The check says it may be sexist.',
  offensive: 'The check says it may be offensive.',
  rude: 'The check says it may be rude.',
  flagged: 'Paddlers flagged it as wrong, and it was hidden.',
  unchecked: "The check couldn't run, so it wasn't published.",
}

/** Text safe to put in a public issue: no links, @mentions, issue references or markup. */
export function safeForIssue(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?/gi, ' ')
    .replace(/@[\w-]+/g, ' ')
    .replace(/[\w.-]*#\d+/g, ' ')
    .replace(/[[\]()`<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SHOWN)
}

/** Title and body. `lockName` comes from our own feature list, never from the note. */
export function buildHeldNoteIssue(c: HeldNote, verdict: PortageVerdict, lockName?: string): { title: string; body: string } {
  const shown = verdict.bleepedPassed && verdict.bleeped ? safeForIssue(verdict.bleeped) : ''
  const key = `portages/${verdict.category === 'flagged' ? 'public' : 'pending'}/${c.id}.json`
  return {
    title: `Portage note held for review at ${lockName ?? 'a lock'}`,
    body: [
      'A portage note is hidden from Plan until someone decides.',
      '',
      `- **Where:** ${lockName ?? 'a lock'} (${c.at[0].toFixed(5)}, ${c.at[1].toFixed(5)})`,
      `- **Added:** ${c.createdAt.slice(0, 10)}`,
      `- **Why:** ${WHY[verdict.category]}`,
      shown ? `- **The note, bleeped:** ${shown}` : '- **The note:** not shown here.',
      '',
      'Read the original:',
      '```',
      `AWS_PROFILE=paddlesnitch aws s3 cp s3://${BUCKET}/${key} -`,
      '```',
      'Then decide:',
      '```',
      `pnpm --filter web waterways:review ${c.id} publish`,
      `pnpm --filter web waterways:review ${c.id} remove`,
      '```',
    ].join('\n'),
  }
}
