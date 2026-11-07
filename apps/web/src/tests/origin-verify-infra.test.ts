// Only CloudFront may call the server (#908), checked from the stack's source
// like the other infra tests: the server origin carries x-origin-verify, the
// server Lambda gets the accepted values, both from the one SSM parameter, and
// no secret is written into the repo. `cdk synth` showed the same in the
// template (CloudFormation parameter of type AWS::SSM::Parameter::Value<String>).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.join(__dirname, '../../../..')
const stack = readFileSync(path.join(root, 'infra/lib/att-stack.ts'), 'utf8')
const serverFn = stack.slice(stack.indexOf("new lambda.Function(this, 'ServerFn'"), stack.indexOf('const serverUrl'))

describe('only CloudFront may call the server (#908): the stack', () => {
  it('reads the value from SSM by name, not from the source', () => {
    expect(stack).toContain("const originVerify = ssm.StringParameter.valueForStringParameter(this, '/att/origin-verify')")
  })

  it('the server origin sends the first value as x-origin-verify', () => {
    const start = stack.indexOf('const serverOrigin = new origins.HttpOrigin(')
    expect(start).toBeGreaterThan(0)
    const origin = stack.slice(start, stack.indexOf('const imageOptOrigin'))
    expect(origin).toContain("customHeaders: { 'x-origin-verify': cdk.Fn.select(0, cdk.Fn.split(',', originVerify)) }")
  })

  it('the server Lambda gets every accepted value and a mode', () => {
    expect(serverFn).toContain('ORIGIN_VERIFY_SECRETS: originVerify,')
    expect(serverFn).toMatch(/ORIGIN_VERIFY_MODE: '(report|enforce)',/)
  })

  it('every behaviour that reaches the server Lambda uses serverOrigin (so carries the header)', () => {
    const dist = stack.slice(stack.indexOf("new cloudfront.Distribution(this, 'Distribution'"))
    const origins = [...dist.slice(0, dist.indexOf('\n    })\n')).matchAll(/origin: (\w+),/g)].map((m) => m[1])
    expect(origins).toContain('serverOrigin')
    // The others are S3 (OAC) or the image function, never the server URL.
    for (const o of origins) expect(['serverOrigin', 'imageOptOrigin', 'assetsOrigin', 'gamesOrigin']).toContain(o)
    expect(stack.match(/serverUrl\.url/g)).toHaveLength(1)
  })

  it('the header name matches what the proxy checks', async () => {
    const { ORIGIN_VERIFY_HEADER } = await import('@/lib/origin-verify')
    expect(stack).toContain(`'${ORIGIN_VERIFY_HEADER}'`)
  })
})
