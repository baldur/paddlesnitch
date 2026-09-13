#!/usr/bin/env tsx
/**
 * One-command dev stack:
 *   1. write .cognito/config.json so cognito-local knows about our Lambda
 *      triggers (needed BEFORE cognito-local starts)
 *   2. start the lambda-emulator on :9231 so cognito-local can invoke
 *      Custom Auth triggers
 *   3. start cognito-local on :9229 (if not already running)
 *   4. create pool + client + .env.local (idempotent)
 *   5. start `next dev` and stream its output
 *   6. on Ctrl+C, kill all children cleanly
 *
 * Usage:  pnpm dev
 */
import { spawn, ChildProcess } from 'child_process'
import { createConnection } from 'net'
import { createRequire } from 'module'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const require = createRequire(import.meta.url)
const COGNITO_PORT = 9229
const LAMBDA_PORT = 9231

const COLOURS = {
  cognito: '\x1b[36m',  // cyan
  lambda: '\x1b[34m',   // blue
  next: '\x1b[35m',     // magenta
  info: '\x1b[33m',     // yellow
  reset: '\x1b[0m',
}

function tag(label: keyof typeof COLOURS, line: string): string {
  return `${COLOURS[label]}[${label}]${COLOURS.reset} ${line}`
}

function log(label: keyof typeof COLOURS, message: string) {
  process.stdout.write(tag(label, message) + '\n')
}

function pipeWithTag(stream: NodeJS.ReadableStream, label: keyof typeof COLOURS, dest: NodeJS.WriteStream) {
  let buffer = ''
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line) dest.write(tag(label, line) + '\n')
    }
  })
  stream.on('end', () => {
    if (buffer) dest.write(tag(label, buffer) + '\n')
  })
}

function portInUse(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise(resolve => {
    const s = createConnection({ port, host })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => { resolve(false) })
  })
}

function waitForLine(proc: ChildProcess, match: string, timeoutMs = 10000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${match}"`)), timeoutMs)
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes(match)) {
        clearTimeout(t)
        resolve()
      }
    }
    proc.stdout?.on('data', onData)
    proc.on('exit', code => { clearTimeout(t); reject(new Error(`process exited with ${code} before ready`)) })
  })
}

function runOnce(cmd: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`)))
  })
}

// Tell cognito-local how to invoke our Custom Auth Lambdas. The TriggerFunctions
// names match what the CDK stack deploys, and LambdaClient.endpoint points at
// our local emulator.
function writeCognitoLocalConfig() {
  const dir = join(process.cwd(), '.cognito')
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, 'config.json')
  const desired = {
    LambdaClient: {
      endpoint: `http://localhost:${LAMBDA_PORT}`,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      region: 'eu-west-1',
    },
    TriggerFunctions: {
      DefineAuthChallenge: 'att-cognito-define-auth-challenge',
      CreateAuthChallenge: 'att-cognito-create-auth-challenge',
      VerifyAuthChallengeResponse: 'att-cognito-verify-auth-challenge',
    },
  }
  let existing: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, 'utf8')) } catch {}
  }
  writeFileSync(configPath, JSON.stringify({ ...existing, ...desired }, null, 2))
  log('info', `wrote .cognito/config.json (Lambda triggers)`)
}

async function main() {
  let cognito: ChildProcess | null = null
  let lambda: ChildProcess | null = null

  // 1. Config first — cognito-local reads it at start time
  writeCognitoLocalConfig()

  // 2. Lambda emulator
  if (await portInUse(LAMBDA_PORT)) {
    log('info', `lambda-emulator already running on :${LAMBDA_PORT}, reusing it`)
  } else {
    log('info', `starting lambda-emulator on :${LAMBDA_PORT}`)
    lambda = spawn(
      'npx',
      ['tsx', 'scripts/lambda-emulator.ts'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOCAL_DEV: 'true', LAMBDA_EMULATOR_PORT: String(LAMBDA_PORT) } }
    )
    pipeWithTag(lambda.stdout!, 'lambda', process.stdout)
    pipeWithTag(lambda.stderr!, 'lambda', process.stderr)
    await waitForLine(lambda, 'Lambda emulator listening')
  }

  // 3. cognito-local
  if (await portInUse(COGNITO_PORT)) {
    log('info', `cognito-local already running on :${COGNITO_PORT}, reusing it`)
  } else {
    log('info', `starting cognito-local on :${COGNITO_PORT}`)
    cognito = spawn(
      'node',
      [require.resolve('cognito-local/lib/bin/start.js')],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    pipeWithTag(cognito.stdout!, 'cognito', process.stdout)
    pipeWithTag(cognito.stderr!, 'cognito', process.stderr)
    await waitForLine(cognito, 'Cognito Local running')
  }

  // 4. init pool / client
  log('info', 'initialising pool/client (idempotent)')
  await runOnce('npx', ['tsx', '--env-file-if-exists=.env.local', 'scripts/cognito-init.ts'])

  // 5. next dev
  log('info', 'starting next dev')
  const next = spawn('npx', ['next', 'dev'], { stdio: 'inherit' })

  const cleanup = (code: number) => {
    if (cognito && !cognito.killed) cognito.kill('SIGTERM')
    if (lambda && !lambda.killed) lambda.kill('SIGTERM')
    if (!next.killed) next.kill('SIGTERM')
    process.exit(code)
  }

  process.on('SIGINT', () => cleanup(0))
  process.on('SIGTERM', () => cleanup(0))
  next.on('exit', code => cleanup(code ?? 0))
  cognito?.on('exit', code => {
    log('info', `cognito-local exited (${code}), shutting down`)
    cleanup(code ?? 1)
  })
  lambda?.on('exit', code => {
    log('info', `lambda-emulator exited (${code}), shutting down`)
    cleanup(code ?? 1)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
