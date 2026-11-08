import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'

// The token for filing issues on the public repo: from the environment locally
// and in tests, from SSM in production.
let cachedToken: string | undefined

export async function getGitHubToken(): Promise<string | undefined> {
  const direct = process.env.GITHUB_ISSUES_TOKEN
  if (direct) return direct
  if (cachedToken) return cachedToken
  const paramName = process.env.GITHUB_ISSUES_TOKEN_PARAM
  if (!paramName) return undefined
  try {
    const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'eu-west-1' })
    const res = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }))
    cachedToken = res.Parameter?.Value
    return cachedToken
  } catch (err) {
    console.error('[feedback] could not fetch GitHub token from SSM:', err)
    return undefined
  }
}

/** Drops the cached token after GitHub refuses it, so a replaced one is picked up. */
export function forgetGitHubToken() { cachedToken = undefined }
