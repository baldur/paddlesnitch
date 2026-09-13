// One-time ops for the Strava push subscription (docs/features/strava-auto-import.md).
// Strava allows ONE subscription per API application; the callback must be live
// in prod BEFORE `create` (Strava validates it synchronously).
//
// Usage (needs Strava client id/secret + verify token — via direct env for a
// quick run, or STRAVA_*_PARAM + AWS creds to read them from SSM):
//   pnpm --filter web strava:webhook view
//   pnpm --filter web strava:webhook create        # callback defaults to prod
//   pnpm --filter web strava:webhook delete <id>
//
// Override the callback for a non-prod test with STRAVA_WEBHOOK_CALLBACK_URL.
import {
  createWebhookSubscription, viewWebhookSubscriptions,
  deleteWebhookSubscription, getWebhookVerifyToken,
} from '@paddlesnitch/core/strava'

const cmd = process.argv[2]
const CALLBACK = process.env.STRAVA_WEBHOOK_CALLBACK_URL ?? 'https://paddlesnitch.com/api/strava/webhook'

async function main() {
  if (cmd === 'view') {
    console.log(JSON.stringify(await viewWebhookSubscriptions(), null, 2))
  } else if (cmd === 'create') {
    const token = await getWebhookVerifyToken()
    if (!token) throw new Error('No verify token — set STRAVA_WEBHOOK_VERIFY_TOKEN or _PARAM (+ AWS creds).')
    console.log('Creating subscription with callback', CALLBACK, '…')
    console.log(JSON.stringify(await createWebhookSubscription(CALLBACK, token), null, 2))
  } else if (cmd === 'delete') {
    const id = Number(process.argv[3])
    if (!id) throw new Error('usage: strava:webhook delete <id>')
    await deleteWebhookSubscription(id)
    console.log('deleted subscription', id)
  } else {
    console.log('usage: strava:webhook view | create | delete <id>')
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
