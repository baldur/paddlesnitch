// Who may assume the AWS deploy role (AdministratorAccess). Security audit
// 2026-09: the role trusted `ref:refs/heads/main`, which EVERY workflow on main
// presents -- including the Claude jobs that run on anonymous public issues
// with Bash and id-token: write. The deploy role must be reachable only from
// jobs that declare the `production` environment.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const stack = readFileSync(path.join(repo, 'infra/lib/att-stack.ts'), 'utf8')
const trust = stack.slice(stack.indexOf("new iam.Role(this, 'GithubDeployRole'"), stack.indexOf('managedPolicies', stack.indexOf("new iam.Role(this, 'GithubDeployRole'")))

const workflow = (f: string) => readFileSync(path.join(repo, '.github/workflows', f), 'utf8')

// The jobs of a workflow, as [name, body] (a job starts at two-space indent).
function jobs(src: string): [string, string][] {
  const body = src.slice(src.indexOf('\njobs:'))
  return [...body.matchAll(/\n  ([\w-]+):\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/g)].map(m => [m[1], m[2]])
}

describe('AWS deploy role trust', () => {
  it('trusts jobs in the production environment', () => {
    expect(trust).toContain("'repo:baldur@759/paddlesnitch@1254392477:environment:production'")
  })

  it('no longer trusts every workflow on main', () => {
    expect(trust).not.toMatch(/ref:refs\/heads\/main'/)
  })

  it('every job that assumes an AWS role declares the production environment', () => {
    for (const f of ['deploy.yml', 'firmware-release.yml']) {
      for (const [name, body] of jobs(workflow(f))) {
        if (body.includes('configure-aws-credentials')) expect(body, `${f} ${name}`).toMatch(/\n    environment: production\n/)
      }
    }
  })

  it('the Claude workflows never run in the production environment', () => {
    for (const f of ['claude-intake.yml', 'claude-fast-loop.yml']) expect(workflow(f)).not.toMatch(/environment:\s*production/)
  })

  it('the fast loop only reacts to comments from people with a role in the repo', () => {
    expect(workflow('claude-fast-loop.yml')).toMatch(/author_association/)
  })
})
