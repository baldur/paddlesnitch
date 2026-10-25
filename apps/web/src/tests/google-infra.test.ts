// Sign in with Google in the stack (#697), checked from its source like the
// other infra tests: the provider, its scopes and mapping, the hosted domain,
// the app client's flows, the PreSignUp trigger, and that no secret is written
// into the stack.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.join(__dirname, '../../../..')
const stack = readFileSync(path.join(root, 'infra/lib/att-stack.ts'), 'utf8')
const deploy = readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8')

describe('Sign in with Google in the stack', () => {
  it('a Google provider with openid, email and profile, mapping email, email_verified and name', () => {
    expect(stack).toContain('new cognito.UserPoolIdentityProviderGoogle(')
    expect(stack).toContain("scopes: ['openid', 'email', 'profile']")
    expect(stack).toContain('email: cognito.ProviderAttribute.GOOGLE_EMAIL')
    expect(stack).toContain('emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED')
    expect(stack).toContain('fullname: cognito.ProviderAttribute.GOOGLE_NAME')
  })

  it('the secret comes from Secrets Manager by name and the ID from SSM; neither is in the source', () => {
    expect(stack).toContain("cdk.SecretValue.secretsManager('paddlesnitch/google-client-secret')")
    expect(stack).toContain("valueForStringParameter(this, '/att/google-client-id')")
    expect(stack).not.toMatch(/GOCSPX-|apps\.googleusercontent\.com/)
  })

  it('the app client allows only the code flow, back to our callback, with Google as a provider', () => {
    const client = stack.slice(stack.indexOf("new cognito.UserPoolClient(this, 'UserPoolClient'"), stack.indexOf('userPoolClient.node.addDependency(google)'))
    expect(client).toContain('flows: { authorizationCodeGrant: true }')
    expect(client).not.toMatch(/implicitCodeGrant/)
    expect(client).toContain("callbackUrls: ['https://paddlesnitch.com/att/api/auth/google/callback']")
    expect(client).toContain('cognito.UserPoolClientIdentityProvider.GOOGLE')
  })

  it('the hosted domain, its address on the server, and the PreSignUp trigger', () => {
    expect(stack).toContain("cognitoDomain: { domainPrefix: 'paddlesnitch' }")
    expect(stack).toContain('COGNITO_DOMAIN: hostedDomain.baseUrl()')
    expect(stack).toContain('userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUp)')
  })

  it('the button is switched on per build by the GOOGLE_SIGNIN repository variable', () => {
    expect(deploy).toContain('NEXT_PUBLIC_GOOGLE_SIGNIN: ${{ vars.GOOGLE_SIGNIN }}')
  })
})
