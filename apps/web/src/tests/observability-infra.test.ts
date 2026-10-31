// The dashboards and zero-tolerance alarms (docs/features/observability.md),
// checked from the stack source like ses-delivery-alerts.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.join(__dirname, '../../../..')
const stack = readFileSync(path.join(root, 'infra/lib/att-stack.ts'), 'utf8')
const dashboards = readFileSync(path.join(root, 'infra/lib/dashboards.ts'), 'utf8')
const alarmBlock = (id: string) => stack.slice(stack.indexOf(`alarm('${id}'`), stack.indexOf(`alarm('${id}'`) + 700)

describe('dashboards', () => {
  it('stay at the three free ones: health, api, firmware', () => {
    const names = [...dashboards.matchAll(/dashboardName: '([^']+)'/g)].map(m => m[1])
    expect(names.sort()).toEqual(['paddlesnitch-api', 'paddlesnitch-firmware', 'paddlesnitch-health'])
  })

  it('the health dashboard shows every alarm, and errors that should read 0', () => {
    expect(dashboards).toContain("new cloudwatch.AlarmStatusWidget({ title: 'Alarms', alarms,")
    expect(dashboards).toContain("title: 'Errors in the selected range (all should be 0)'")
    expect(stack).toContain('addDashboards(this, { serverFn, distribution, alarms: allAlarms })')
  })

  it('every alarm is defined before the dashboards are, so none is missing from the status widget', () => {
    const lastAlarm = stack.lastIndexOf("alarm('")
    expect(stack.indexOf('addDashboards(this')).toBeGreaterThan(lastAlarm)
  })
})

describe('zero-tolerance alarms fire on the first one in 15 minutes', () => {
  it.each([
    ['ApiErrorsAlarm', 'paddlesnitch-api-errors', "count15('Paddlesnitch/Api', 'ServerErrors')"],
    ['ActionFailedAlarm', 'paddlesnitch-action-failed', "count15('Paddlesnitch/Actions', 'Failures')"],
    ['AppCrashAlarm', 'paddlesnitch-app-crashes', "count15('Paddlesnitch/App', 'Count', { Event: 'crash_report' })"],
    ['BrowserErrorAlarm', 'paddlesnitch-browser-errors', "count15('Paddlesnitch/App', 'Count', { Event: 'client_error' })"],
  ])('%s', (id, name, metric) => {
    const block = alarmBlock(id)
    expect(block).toContain(`alarmName: '${name}'`)
    expect(block).toContain(`metric: ${metric}, ...firstOne`)
  })

  it('"first one" means more than zero in a 15-minute window', () => {
    expect(stack).toContain("statistic: 'Sum', period: cdk.Duration.minutes(15) })")
    expect(stack).toContain('const firstOne = { threshold: 0, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, evaluationPeriods: 1 }')
  })

  it('any error the server logs is worth an email', () => {
    const block = alarmBlock('ServerErrorLogAlarm')
    expect(block).toContain("'ServerErrorLines').with({ period: cdk.Duration.minutes(15) })")
    expect(block).toContain('threshold: 0,')
  })
})

// The analytics archive (docs/features/observability.md § Archive): every
// analytics event kept in S3 indefinitely, as the privacy page says.
describe('analytics archive', () => {
  const from = stack.indexOf("new s3.Bucket(this, 'AnalyticsArchive'")
  const block = stack.slice(from, stack.indexOf("alarm('AnalyticsArchiveDeliveryAlarm'", from))
  const privacy = readFileSync(path.join(root, 'apps/web/src/app/privacy/page.tsx'), 'utf8')

  it('subscribes the server log group, through Firehose and the transform, into the archive bucket', () => {
    expect(block).toContain('logGroupName: serverLogs.logGroupName')
    expect(block).toContain("filterPattern: 'Event'")
    expect(block).toContain("type: 'Lambda'")
    expect(block).toContain('lambdas/analytics-archive')
    expect(block).toContain("prefix: 'events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/'")
    expect(block).toContain("errorOutputPrefix: 'errors/")
    expect(block).toContain("compressionFormat: 'GZIP'")
    expect(block).toContain("{ parameterName: 'BufferSizeInMBs', parameterValue: '0.25' }")
    expect(block).toContain("actions: ['lambda:GetFunctionConfiguration']")
  })

  it('keeps events indefinitely: the only rule expires failed batches, and the privacy page says so', () => {
    expect(block).toContain("lifecycleRules: [{ id: 'expire-errors', prefix: 'errors/', expiration: cdk.Duration.days(30) }],")
    expect(block.match(/lifecycleRules|expiration|transitions|noncurrentVersion/g)).toEqual(['lifecycleRules', 'expiration'])
    expect(block).toContain('removalPolicy: cdk.RemovalPolicy.RETAIN')
    expect(privacy).toContain('We keep these records indefinitely')
  })

  it('lets Firehose write but never delete, and only on our behalf', () => {
    expect(block).not.toMatch(/analyticsBucket\.grant(Write|ReadWrite|Delete)/)
    expect(block).toContain("actions: ['s3:PutObject', 's3:AbortMultipartUpload']")
    expect(block.match(/'aws:SourceAccount': this\.account/g)).toHaveLength(2)
  })

  it('lets only the root user read the archive', () => {
    expect(block).toContain("sid: 'OnlyRootReadsTheArchive'")
    expect(block).toContain("conditions: { StringNotEquals: { 'aws:PrincipalArn': `arn:aws:iam::${this.account}:root` } }")
  })

  it('emails on any failed batch', () => {
    expect(stack).toContain("alarm('AnalyticsArchiveTransformAlarm'")
    expect(stack).toContain("alarm('AnalyticsArchiveDeliveryAlarm'")
  })
})
