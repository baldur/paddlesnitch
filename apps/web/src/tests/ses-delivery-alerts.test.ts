// Bounce and complaint handling for SES (#22, #23). AWS asks for it before
// granting production access, and a bounce we never hear about hurts the
// sender reputation sign-in codes depend on.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.join(__dirname, '../../../..')
const stack = readFileSync(path.join(root, 'infra/lib/att-stack.ts'), 'utf8')
const after = (marker: string, n = 600) => stack.slice(stack.indexOf(marker), stack.indexOf(marker) + n)

describe('SES delivery problems reach us', () => {
  it('every bounce, complaint and reject on the default configuration set goes to the alerts topic', () => {
    const dest = after("new ses.CfnConfigurationSetEventDestination(this, 'SesDeliveryProblems'")
    expect(dest).toContain("configurationSetName: 'my-first-configuration-set'")
    expect(dest).toContain("matchingEventTypes: ['bounce', 'complaint', 'reject']")
    expect(dest).toContain('snsDestination: { topicArn: alerts.topicArn }')
  })

  it('SES may publish to the alerts topic, from this account only', () => {
    const policy = after('alerts.addToResourcePolicy(')
    expect(policy).toContain("new iam.ServicePrincipal('ses.amazonaws.com')")
    expect(policy).toContain("actions: ['sns:Publish']")
    expect(policy).toContain("'AWS:SourceAccount': this.account")
  })

  it('bounce and complaint rates both alarm well before SES pauses sending', () => {
    expect(after("alarm('SesBounceAlarm'")).toContain('threshold: 0.05')
    expect(after("alarm('SesComplaintAlarm'")).toContain("metricName: 'Reputation.ComplaintRate'")
    expect(after("alarm('SesComplaintAlarm'")).toContain('threshold: 0.001')
  })

  it('DMARC reports to dmarc@ are kept in S3, not forwarded to a person', () => {
    const rule = after("ruleSet.addRule('DmarcReports'")
    expect(rule).toContain("recipients: ['dmarc@paddlesnitch.com']")
    expect(rule).toContain("objectKeyPrefix: 'inbound-email/dmarc/'")
    expect(rule).not.toContain('sesActions.Lambda')
  })
})
