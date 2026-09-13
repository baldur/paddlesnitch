#!/usr/bin/env tsx
/**
 * Creates a Cognito user pool + client in the cognito-local emulator,
 * then prints the env vars to add to .env.local.
 *
 * Idempotent — re-running reuses the existing pool/client when found.
 * Run after `pnpm cognito` is up.
 */
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  CreateUserPoolCommand,
  ListUserPoolClientsCommand,
  CreateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const POOL_NAME = 'atts-local'
const CLIENT_NAME = 'atts-web-local'
const ENDPOINT = 'http://localhost:9229'

const client = new CognitoIdentityProviderClient({
  endpoint: ENDPOINT,
  region: 'eu-west-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})

async function findOrCreatePool(): Promise<string> {
  const list = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }))
  const existing = list.UserPools?.find(p => p.Name === POOL_NAME)
  if (existing?.Id) {
    console.log(`✓ Reusing pool ${POOL_NAME} (${existing.Id})`)
    return existing.Id
  }
  const created = await client.send(new CreateUserPoolCommand({
    PoolName: POOL_NAME,
    AutoVerifiedAttributes: ['email'],
    UsernameAttributes: ['email'],
    Schema: [
      { Name: 'email', AttributeDataType: 'String', Required: true, Mutable: true },
      { Name: 'name', AttributeDataType: 'String', Required: false, Mutable: true },
    ],
    Policies: {
      PasswordPolicy: {
        MinimumLength: 8,
        RequireUppercase: true,
        RequireLowercase: true,
        RequireNumbers: true,
        RequireSymbols: false,
      },
    },
  }))
  const id = created.UserPool!.Id!
  console.log(`✓ Created pool ${POOL_NAME} (${id})`)
  return id
}

async function findOrCreateClient(poolId: string): Promise<string> {
  const list = await client.send(new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 }))
  const existing = list.UserPoolClients?.find(c => c.ClientName === CLIENT_NAME)
  if (existing?.ClientId) {
    console.log(`✓ Reusing client ${CLIENT_NAME} (${existing.ClientId})`)
    return existing.ClientId
  }
  const created = await client.send(new CreateUserPoolClientCommand({
    UserPoolId: poolId,
    ClientName: CLIENT_NAME,
    GenerateSecret: false,
    ExplicitAuthFlows: [
      'ALLOW_USER_PASSWORD_AUTH',
      'ALLOW_ADMIN_USER_PASSWORD_AUTH',
      'ALLOW_REFRESH_TOKEN_AUTH',
      'ALLOW_CUSTOM_AUTH',
    ],
    PreventUserExistenceErrors: 'ENABLED',
  }))
  const id = created.UserPoolClient!.ClientId!
  console.log(`✓ Created client ${CLIENT_NAME} (${id})`)
  return id
}

function writeEnvLocal(poolId: string, clientId: string) {
  const envPath = join(process.cwd(), '.env.local')
  const desired: Record<string, string> = {
    NODE_ENV: 'development',
    USE_LOCAL_STORAGE: 'true',
    COGNITO_ENDPOINT: ENDPOINT,
    COGNITO_USER_POOL_ID: poolId,
    COGNITO_CLIENT_ID: clientId,
    COGNITO_REGION: 'eu-west-1',
  }
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const lines = existing.split('\n')
  const updated: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=/)
    if (match && match[1] in desired) {
      updated.push(`${match[1]}=${desired[match[1]]}`)
      seen.add(match[1])
    } else {
      updated.push(line)
    }
  }
  for (const [key, value] of Object.entries(desired)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`)
  }
  while (updated.length && updated[updated.length - 1] === '') updated.pop()
  updated.push('')
  writeFileSync(envPath, updated.join('\n'))
  console.log(`✓ Wrote .env.local`)
}

async function main() {
  try {
    const poolId = await findOrCreatePool()
    const clientId = await findOrCreateClient(poolId)
    writeEnvLocal(poolId, clientId)
    console.log('\nDone. Restart `pnpm dev` to pick up env changes.')
  } catch (err) {
    if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
      console.error('Error: cognito-local is not running. Start it first with `pnpm cognito`.')
      process.exit(1)
    }
    throw err
  }
}

main()
