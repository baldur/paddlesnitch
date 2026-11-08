// The public GitHub issue for a portage note held for review. Pure. The issue is
// public for good, and even a lock, a date or an id could tie a note later
// published in the CC0 dump to a named paddler, so it carries the reason and a
// random ref. Everything else is read with waterways:review.
import type { PortageVerdict } from './portage'

const WHY: Record<PortageVerdict['category'], string> = {
  racist: 'The check says it may be racist.',
  sexist: 'The check says it may be sexist.',
  offensive: 'The check says it may be offensive.',
  rude: 'The check says it may be rude.',
  flagged: 'Paddlers flagged it as wrong, and it was hidden.',
  unchecked: "The check couldn't run, so it wasn't published.",
}

export function buildHeldNoteIssue(ref: string, category: PortageVerdict['category']): { title: string; body: string } {
  const run = 'AWS_PROFILE=paddlesnitch pnpm --filter web waterways:review'
  return {
    title: 'A portage note needs review',
    body: [
      'A portage note is hidden from Plan until someone decides.',
      '',
      `**Why:** ${WHY[category]}`,
      '',
      'Read it, then decide:',
      '```',
      `${run} ${ref} show`,
      `${run} ${ref} publish`,
      `${run} ${ref} remove`,
      '```',
    ].join('\n'),
  }
}
