// Every folder in public/ needs its own CloudFront behavior pointing at the
// assets bucket (infra/lib/att-stack.ts). OpenNext puts public files in S3 only;
// without a behavior the request goes to the server Lambda and 404s in prod
// while working fine locally. That broke the Strava brand images once (#135)
// and nearly shipped the beta testers video the same way.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const publicDir = path.join(repo, 'apps/web/public')
const stack = readFileSync(path.join(repo, 'infra/lib/att-stack.ts'), 'utf8')

describe('public/ folders are routed to the assets bucket in prod', () => {
  const dirs = readdirSync(publicDir).filter(d => statSync(path.join(publicDir, d)).isDirectory())
  it.each(dirs)('/%s/* has a CloudFront behavior', dir => {
    expect(stack).toContain(`'/${dir}/*': {`)
  })
})
