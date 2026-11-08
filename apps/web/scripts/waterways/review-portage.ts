#!/usr/bin/env node
// The owner's decision on a held portage note, from the command line: there's
// no admin screen on purpose. Reads the note with your own AWS sign-in, updates
// it and closes its GitHub issue.
//
//   AWS_PROFILE=paddlesnitch pnpm --filter web waterways:review <ref> show|publish|remove
import { execFileSync } from 'child_process'

process.env.DATA_BUCKET ??= 'paddlesnitch-data-prod'
process.env.AWS_REGION ??= 'eu-west-1'

async function main() {
  const [ref, action] = process.argv.slice(2)
  if (!ref || !['show', 'publish', 'remove'].includes(action)) throw new Error('usage: waterways:review <ref> show|publish|remove')
  // Imported here so the store reads the settings above.
  const { finishReview, getReview, getReviewedPortage, reviewPortage } = await import('@paddlesnitch/waterways/portage-store')
  if (!(await getReview(ref))) throw new Error(`Nothing to review for ${ref}.`)
  if (action === 'show') {
    const c = await getReviewedPortage(ref)
    console.log(c ? JSON.stringify(c, null, 2) : 'Its author withdrew this note. Run publish or remove to close the issue.')
    return
  }
  const done = await reviewPortage(ref, action as 'publish' | 'remove')
  if (!done) throw new Error(`Nothing to review for ${ref}.`)
  // The comment is public: it mustn't say which, or the timing could tie this note to a newly published one.
  const comment = done.outcome === 'withdrawn' ? 'The note was withdrawn by its author.' : 'Reviewed.'
  execFileSync('gh', ['issue', 'close', String(done.issue), '--comment', comment], { stdio: 'inherit' })
  await finishReview(ref)
  console.log(`${done.outcome}, closed #${done.issue}`)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
