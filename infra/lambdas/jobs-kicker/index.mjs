// The jobs kicker (apps/web/src/lib/jobs.ts, #413). Started by S3 when a job
// file lands under jobs/, and by a 5-minute timer. It asks the site's server to
// run the work, so the work runs with the server's own code and settings; this
// function holds nothing but the address.
//
//   S3 ObjectCreated  -> POST {SITE_URL}/api/jobs/run   { key }   (one per new file)
//   timer { sweep }   -> POST {SITE_URL}/api/jobs/sweep
//
// A failed call throws, so Lambda retries an S3 announcement twice; the sweep
// catches anything still left after that.
const SITE = process.env.SITE_URL

async function post(path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} ${res.status} ${text.slice(0, 200)}`)
  return text
}

export const handler = async event => {
  if (event?.sweep) {
    console.log('[jobs-kicker] sweep', await post('/api/jobs/sweep'))
    return
  }
  for (const r of event?.Records ?? []) {
    // S3 URL-encodes keys in events (spaces as +).
    const key = decodeURIComponent((r.s3?.object?.key ?? '').replace(/\+/g, ' '))
    if (!key.startsWith('jobs/')) continue
    console.log('[jobs-kicker]', key, await post('/api/jobs/run', { key }))
  }
}
