// The gate is the night shift's only way to the model, and Ollama can reach
// the internet: everything that downloads, uploads or builds a model is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowed } from './ollama-gate.mjs'

test('chat, completion and listing pass', () => {
  for (const [m, u] of [['POST', '/api/chat'], ['POST', '/api/generate'], ['GET', '/api/tags'], ['POST', '/v1/chat/completions'], ['GET', '/v1/models'], ['GET', '/v1/models/']])
    assert.ok(allowed(m, u), `${m} ${u}`)
})

test('pull, push, create, copy, delete and blobs are refused', () => {
  for (const [m, u] of [['POST', '/api/pull'], ['POST', '/api/push'], ['POST', '/api/create'], ['POST', '/api/copy'], ['DELETE', '/api/delete'], ['POST', '/api/blobs/sha256:00'], ['HEAD', '/api/blobs/sha256:00']])
    assert.ok(!allowed(m, u), `${m} ${u}`)
})

test('a refused path cannot be dressed up as an allowed one', () => {
  for (const [m, u] of [['POST', '/api/chat/../pull'], ['POST', '/api/pull?x=/api/chat'], ['GET', '/api/chat'], ['POST', '//api/pull'], ['POST', '/API/CHAT']])
    assert.ok(!allowed(m, u), `${m} ${u}`)
})

test('only the night-shift model may be asked', async () => {
  const { modelAllowed } = await import('./ollama-gate.mjs')
  assert.ok(modelAllowed(Buffer.from('{"model":"qwen3.8-64k:latest","messages":[]}')))
  assert.ok(modelAllowed(Buffer.from('')))
  assert.ok(!modelAllowed(Buffer.from('{"model":"qwen2.5vl:32b"}')))
  assert.ok(!modelAllowed(Buffer.from('{"model":"someone.example/x"}')))
  assert.ok(!modelAllowed(Buffer.from('not json')))
})
