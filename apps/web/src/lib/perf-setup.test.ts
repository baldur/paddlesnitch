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
    const charted = JSON.parse(/const perfPages = (\[[^\]]+\])/.exec(stack)![1].replace(/'/g, '"'))
    expect(charted).toEqual(names(script))
  })

  it("gives the check's role metrics in its own namespace and nothing else", () => {
    const role = stack.slice(stack.indexOf("new iam.Role(this, 'GithubPerfRole'"), stack.indexOf("new cdk.CfnOutput(this, 'PerfRoleArn'"))
    expect(role).toContain("actions: ['cloudwatch:PutMetricData']")
    expect(role).toContain("'cloudwatch:namespace': 'Paddlesnitch/Perf'")
    expect(role).toContain('environment:perf')
    expect(role).not.toContain('environment:production')
    expect(role).not.toMatch(/ManagedPolicy|AdministratorAccess/)
  })

  it('runs in the perf environment, never production', () => {
    expect(workflow).toMatch(/environment: perf\n/)
    expect(workflow).not.toContain('environment: production')
  })

  it('reports even when CloudWatch is out of reach', () => {
    const send = workflow.slice(workflow.indexOf('- name: AWS credentials'))
    expect(send.match(/continue-on-error: true/g)?.length).toBe(2)
    expect(workflow.indexOf('pnpm perf')).toBeLessThan(workflow.indexOf('- name: AWS credentials'))
    expect(workflow).toMatch(/- name: Keep the results\n\s+if: always\(\)/)
  })
})
