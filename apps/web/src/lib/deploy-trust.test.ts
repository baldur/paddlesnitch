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

describe('AWS deploy role trust', () => {
  it('trusts jobs in the production environment', () => {
    expect(trust).toContain("'repo:baldur@759/paddlesnitch@1254392477:environment:production'")
  })
})
