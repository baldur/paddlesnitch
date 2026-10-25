// Daily error digest (docs/features/observability.md). Runs each query in
// digest.mjs over the server Lambda's log group, builds one email and
// publishes it to the alerts topic. Scheduled once a day by EventBridge.
// The AWS SDK comes with the Lambda runtime; nothing is bundled.
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { QUERIES, windowFor, toRows, buildDigest } from './digest.mjs'

const logs = new CloudWatchLogsClient({})
const sns = new SNSClient({})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function run(q, logGroup, nowMs) {
  const { queryId } = await logs.send(new StartQueryCommand({ logGroupName: logGroup, queryString: q.query, ...windowFor(q, nowMs) }))
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const res = await logs.send(new GetQueryResultsCommand({ queryId }))
    if (res.status === 'Complete') return toRows(res.results)
    if (res.status !== 'Running' && res.status !== 'Scheduled') throw new Error(`query ${q.key}: ${res.status}`)
  }
  throw new Error(`query ${q.key}: still running after 60 s`)
}

export async function handler() {
  const logGroup = process.env.LOG_GROUP
  const topicArn = process.env.TOPIC_ARN
  if (!logGroup || !topicArn) throw new Error('LOG_GROUP and TOPIC_ARN are required')
  const nowMs = Date.now()
  const entries = await Promise.all(QUERIES.map(async q => [q.key, await run(q, logGroup, nowMs)]))
  const { subject, text } = buildDigest(Object.fromEntries(entries), { nowMs })
  await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: text }))
  return { subject }
}
