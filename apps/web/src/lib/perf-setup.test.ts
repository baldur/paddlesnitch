// The performance check's pieces stay in step: the dashboard charts the pages
// the check times, the check's AWS role can do one thing only, and the
// workflow reports whether or not CloudWatch is reachable.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const read = (f: string) => readFileSync(path.join(repo, f), 'utf8')
const stack = read('infra/lib/att-stack.ts')
const script = read('apps/web/scripts/perf.ts')
const workflow = read('.github/workflows/perf.yml')

const names = (src: string) => [...src.matchAll(/name: '([^']+)', path:/g)].map(m => m[1])

describe('performance check setup', () => {
  it('charts every page the check times (a renamed page starts a new series)', () => {
    const list = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]+\\])`).exec(stack)![1].replace(/'/g, '"'))
    expect([...list('perfPages'), ...list('perfSignedIn')]).toEqual(names(script))
  })

  it("gives the check's role metrics in its own namespace and nothing else", () => {
    const role = stack.slice(stack.indexOf("new iam.Role(this, 'GithubPerfRole'"), stack.indexOf("new cdk.CfnOutput(this, 'PerfRoleArn'"))
    expect(role).toContain("actions: ['cloudwatch:PutMetricData']")
    // …and reading the test account's password: that one parameter only.
    expect(role).toContain("actions: ['ssm:GetParameter']")
    expect(role.match(/parameter\/[^`'\]]+/g)).toEqual(['parameter/att/perf-check-password'])
    expect(role).toContain("'cloudwatch:namespace': 'Paddlesnitch/Perf'")
    expect(role).toContain('environment:perf')
    expect(role).not.toContain('environment:production')
    expect(role).not.toMatch(/ManagedPolicy|AdministratorAccess/)
  })

  it('runs in the perf environment, never production', () => {
    expect(workflow).toMatch(/environment: perf\n/)
    expect(workflow).not.toContain('environment: production')
  })

  it('reports even when AWS is out of reach (no password: public pages only)', () => {
    const creds = workflow.slice(workflow.indexOf('- name: AWS credentials'), workflow.indexOf('- name: Time the pages'))
    expect(creds).toContain('continue-on-error: true')
    const timing = workflow.slice(workflow.indexOf('- name: Time the pages'), workflow.indexOf('- name: Keep the results'))
    expect(timing).not.toMatch(/\n\s+if:/)        // always runs
    expect(timing).toContain('::add-mask::')        // the password never shows in the log
    const send = workflow.slice(workflow.indexOf('- name: Send the timings'))
    expect(send).toContain('continue-on-error: true')
    expect(workflow).toMatch(/- name: Keep the results\n\s+if: always\(\)/)
  })
})
