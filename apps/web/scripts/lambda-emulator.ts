#!/usr/bin/env tsx
/**
 * Minimal AWS Lambda emulator for local dev.
 *
 * Speaks the Lambda Invoke API (POST /2015-03-31/functions/:name/invocations)
 * so cognito-local can call our Custom Auth trigger Lambdas as if they were
 * deployed.
 *
 * Run alongside cognito-local. cognito-local's LambdaClient.endpoint config
 * should point at this server. Each request loads the matching handler
 * module from infra/lambdas/cognito-auth/ and invokes it.
 *
 * In dev the LOCAL_DEV env var is set so the OTP code is logged to stdout
 * instead of being sent through SES.
 */
import http from 'http'
import { pathToFileURL } from 'url'
import { join, resolve } from 'path'

const PORT = Number(process.env.LAMBDA_EMULATOR_PORT ?? 9231)
// infra/ lives at the repo root; this script runs with cwd = apps/web.
const HANDLERS_DIR = resolve(process.cwd(), '../../infra/lambdas/cognito-auth')

// Map Lambda function name → handler file. The names match what the CDK
// stack will deploy, so the cognito-local config and the prod config use
// the same identifiers.
const FUNCTIONS: Record<string, string> = {
  'att-cognito-define-auth-challenge': 'define-auth-challenge.mjs',
  'att-cognito-create-auth-challenge': 'create-auth-challenge.mjs',
  'att-cognito-verify-auth-challenge': 'verify-auth-challenge.mjs',
}

type Handler = (event: unknown) => Promise<unknown>
const cache = new Map<string, Handler>()

async function loadHandler(name: string): Promise<Handler> {
  const cached = cache.get(name)
  if (cached) return cached
  const filename = FUNCTIONS[name]
  if (!filename) throw new Error(`unknown function: ${name}`)
  const url = pathToFileURL(join(HANDLERS_DIR, filename)).href
  const mod = await import(url) as { handler: Handler }
  cache.set(name, mod.handler)
  return mod.handler
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  // Path is /2015-03-31/functions/:name/invocations
  const m = req.url?.match(/^\/2015-03-31\/functions\/([^/]+)\/invocations/)
  if (req.method !== 'POST' || !m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  const name = decodeURIComponent(m[1])
  try {
    const handler = await loadHandler(name)
    const raw = await readBody(req)
    const event = raw ? JSON.parse(raw) : {}
    const result = await handler(event)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result ?? {}))
  } catch (err) {
    console.error(`[lambda-emulator] ${name}:`, err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      errorMessage: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : 'Error',
    }))
  }
})

server.listen(PORT, () => {
  console.log(`Lambda emulator listening on http://localhost:${PORT}`)
  console.log('Functions:', Object.keys(FUNCTIONS).join(', '))
})
