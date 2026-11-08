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

  it('the server Lambda gets every accepted value and refuses requests without one', () => {
    expect(serverFn).toContain('ORIGIN_VERIFY_SECRETS: originVerify,')
    expect(serverFn).toContain("ORIGIN_VERIFY_MODE: 'enforce',")
    // Set in exactly one place, not commented out, not overridden later
    // (e.g. by addEnvironment).
    expect(stack.match(/ORIGIN_VERIFY_MODE/g)).toHaveLength(1)
    expect(stack).not.toMatch(/^\s*\/\/.*ORIGIN_VERIFY_MODE/m)
  })

  it('every behaviour names one of the known origins; only serverOrigin reaches the server (so carries the header)', () => {
    const start = stack.indexOf("new cloudfront.Distribution(this, 'Distribution'")
    expect(start).toBeGreaterThan(0)
    const dist = stack.slice(start, stack.indexOf('\n    })\n', start))
    // Every `origin:` line, whatever its value: an inline origin
    // (`origin: new origins.FunctionUrlOrigin(serverUrl)`) fails here.
    const values = [...dist.matchAll(/\borigin:\s*([^\n]*)/g)].map((m) => m[1].trim())
    expect(values.length).toBeGreaterThan(5)
    expect(values).toContain('serverOrigin,')
    // The others are S3 (OAC) or the image function, never the server URL.
    for (const v of values) expect(['serverOrigin,', 'imageOptOrigin,', 'assetsOrigin,', 'gamesOrigin,']).toContain(v)
    // Nothing else builds an origin onto the server function: its URL is
    // read once, in serverOrigin, and no origin is made from the URL object.
    expect(stack.match(/serverUrl/g)).toHaveLength(2) // the declaration and serverOrigin
    expect(stack.match(/serverUrl\.url/g)).toHaveLength(1)
    expect(stack).not.toMatch(/FunctionUrlOrigin/)
    expect(stack.match(/new origins\.HttpOrigin\(/g)).toHaveLength(2) // serverOrigin, imageOptOrigin
    expect(stack.match(/serverFn\.addFunctionUrl\(/g)).toHaveLength(1)
  })

  it('the header name matches what the proxy checks', async () => {
    const { ORIGIN_VERIFY_HEADER } = await import('@/lib/origin-verify')
    expect(stack).toContain(`'${ORIGIN_VERIFY_HEADER}'`)
  })
})

describe('only CloudFront may call the server (#908): every deploy checks it', () => {
  const deploy = readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8')
  const step = deploy.slice(deploy.indexOf('- name: Only CloudFront reaches the server'))

  it('a direct call to the function URL must get 403, after the smoke test', () => {
    expect(deploy.indexOf('- name: Only CloudFront reaches the server')).toBeGreaterThan(deploy.indexOf('- name: Smoke test'))
    expect(step).toContain('get-function-url-config')
    expect(step).toContain('[ "$code" = 403 ]')
  })

  it('masks the URL before anything could print it (the log is public)', () => {
    expect(step.indexOf('::add-mask::$url')).toBeGreaterThan(0)
    expect(step.indexOf('::add-mask::$url')).toBeLessThan(step.indexOf('curl'))
    expect(step).not.toMatch(/set -x|echo "\$url"|echo \$url/)
  })
})
