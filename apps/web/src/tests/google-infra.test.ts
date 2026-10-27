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
    const start = stack.indexOf("new cognito.UserPoolClient(this, 'UserPoolClient'")
    const end = stack.indexOf('userPoolClient.node.addDependency(google)')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const client = stack.slice(start, end)
    expect(client).toContain('flows: { authorizationCodeGrant: true }')
    expect(client).not.toMatch(/implicitCodeGrant/)
    expect(client).toContain("callbackUrls: ['https://paddlesnitch.com/att/api/auth/google/callback']")
    expect(client).toContain('cognito.UserPoolClientIdentityProvider.GOOGLE')
  })

  it('the hosted domain, its address on the server, and the PreSignUp trigger', () => {
    expect(stack).toContain("cognitoDomain: { domainPrefix: 'paddlesnitch' }")
    expect(stack).toContain('COGNITO_DOMAIN: hostedDomain.baseUrl()')
    expect(stack).toContain('userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUp)')
    // Its lookup reaches this pool only (the AWS account is shared).
    expect(stack).toContain("actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'], resources: [userPool.userPoolArn]")
    // Connect Google: it reads and deletes only the notes in the data bucket.
    expect(stack).toContain("actions: ['s3:GetObject', 's3:DeleteObject'], resources: [dataBucket.arnForObjects('auth/google-links/*')]")
    expect(stack).toMatch(/handler: 'pre-sign-up.handler'[\s\S]{0,300}environment: \{ DATA_BUCKET: dataBucket.bucketName \}/)
    expect(stack).not.toContain('userpool/*')
  })

  it('the button is switched on per build by the GOOGLE_SIGNIN repository variable', () => {
    expect(deploy).toContain('NEXT_PUBLIC_GOOGLE_SIGNIN: ${{ vars.GOOGLE_SIGNIN }}')
  })
})

describe('the pool proves an email address on sign-up (#702)', () => {
  it('emails a code on sign-up, through Cognito\'s own sender', () => {
    expect(stack).toContain('autoVerify: { email: true, phone: false }')
    expect(stack).not.toContain('autoVerify: { email: false')
    // #713: a new email takes effect only once confirmed. Email is the username,
    // so without this an account could become someone else's address.
    expect(stack).toContain('keepOriginal: { email: true }')
    expect(stack).toContain("emailSubject: 'Your paddlesnitch code'")
    expect(stack).toContain("UserPoolEmail.withCognito(")
  })
})
