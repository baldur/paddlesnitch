#!/usr/bin/env node
// The owner's decision on a held portage note, from the command line: there's
// no admin screen on purpose. Updates the record and closes its GitHub issue.
//
//   AWS_PROFILE=paddlesnitch pnpm --filter web waterways:review <id> publish|remove
import { execFileSync } from 'child_process'

process.env.DATA_BUCKET ??= 'paddlesnitch-data-prod'
process.env.AWS_REGION ??= 'eu-west-1'

async function main() {
  const [id, decision] = process.argv.slice(2)
  if (!id || (decision !== 'publish' && decision !== 'remove')) throw new Error('usage: waterways:review <id> publish|remove')
  // Imported here so the store reads the settings above.
  const { reviewPortage } = await import('@paddlesnitch/waterways/portage-store')
  const done = await reviewPortage(id, decision)
  if (!done) throw new Error(`Nothing to decide for ${id}: it's already decided, or withdrawn.`)
  console.log(`${id}: ${done}`)
  const found = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--label', 'owner-task', '--search', `${id} in:body`, '--json', 'number']).toString()) as { number: number }[]
  for (const { number } of found) {
    execFileSync('gh', ['issue', 'close', String(number), '--comment', `Decided: ${done}.`])
    console.log(`closed #${number}`)
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
