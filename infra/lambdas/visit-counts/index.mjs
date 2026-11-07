// Daily visit counts (#906): counts yesterday's `visit` lines in the server
// log group with Logs Insights and writes one counts file to the analytics
// archive, visits/<yyyy>/<mm>/<dd>.json. Scheduled by EventBridge at 00:30 UTC.
// Idempotent: a rerun (invoke with {"day":"YYYY-MM-DD"}, within the logs' 90
// days) overwrites the same file. The AWS SDK comes with the Lambda runtime.
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { QUERIES, dayWindow, toRows, buildCounts } from './counts.mjs'

const logs = new CloudWatchLogsClient({})
const s3 = new S3Client({})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function query(name, logGroup, { startTime, endTime }) {
  const { queryId } = await logs.send(new StartQueryCommand({ logGroupName: logGroup, queryString: QUERIES[name], startTime, endTime }))
  for (let i = 0; i < 240; i++) {
    await sleep(1000)
    const res = await logs.send(new GetQueryResultsCommand({ queryId }))
    if (res.status === 'Complete') return toRows(res.results)
    if (res.status !== 'Running' && res.status !== 'Scheduled') throw new Error(`query ${name}: ${res.status}`)
  }
  throw new Error(`query ${name}: still running after 240 s`)
}

export async function handler(event) {
  const logGroup = process.env.LOG_GROUP
  const bucket = process.env.BUCKET
  if (!logGroup || !bucket) throw new Error('LOG_GROUP and BUCKET are required')
  const w = dayWindow(Date.now(), event?.day)
  const rows = Object.fromEntries(await Promise.all(Object.keys(QUERIES).map(async (k) => [k, await query(k, logGroup, w)])))
  const counts = buildCounts(w.day, rows)
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: w.key, Body: JSON.stringify(counts), ContentType: 'application/json' }))
  return { key: w.key, visits: counts.visits }
}
