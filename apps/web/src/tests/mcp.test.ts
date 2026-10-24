// @vitest-environment node
// The read-only MCP server (#512): the handshake, the tool list, and tools
// that return exactly what /api/v1 returns.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'
import { POST, GET } from '@/app/mcp/route'

const rpc = async (body: unknown) => {
  const res = await POST(new NextRequest('https://paddlesnitch.com/mcp', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: res.status, body: res.status === 202 ? null : await res.json() }
}

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('MCP server', () => {
  it('initializes in the client’s protocol version, with tools only', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    expect(body.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'paddlesnitch' } })
    const unknown = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect(unknown.body.result.protocolVersion).toBe('2025-06-18')
  })

  it('accepts notifications with 202 and no body', async () => {
    expect(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({ status: 202, body: null })
  })

  it('lists five read-only tools', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(['search_places', 'plan_route', 'list_trials', 'get_trial', 'get_leaderboard'])
    for (const t of body.result.tools) {
      expect(t.annotations.readOnlyHint).toBe(true)
      expect(t.inputSchema.type).toBe('object')
      expect(t).not.toHaveProperty('call')
    }
  })

  it('plan_route returns the API’s plan, by name', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'plan_route', arguments: { from: 'guyers-lock', to: 'aldermaston-wharf', pace: 7 } } })
    expect(body.result.isError).toBe(false)
    expect(body.result.structuredContent.plan).toMatchObject({ pace_kmh: 7, distance_km: expect.any(Number) })
    expect(JSON.parse(body.result.content[0].text).attribution.length).toBeGreaterThan(0)
  })

  it('a tool’s failure is a result with isError, not a protocol error', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_trial', arguments: { trial_id: 'nope' } } })
    expect(body.result.isError).toBe(true)
    expect(JSON.parse(body.result.content[0].text).error.code).toBe('not_found')
    const missing = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'plan_route', arguments: { from: 'x' } } })
    expect(missing.body.result).toMatchObject({ isError: true, content: [{ text: 'Missing: to' }] })
  })

  it('unknown methods and tools are JSON-RPC errors; GET is refused', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 7, method: 'resources/list' })).body.error.code).toBe(-32601)
    expect((await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'delete_everything' } })).body.error.code).toBe(-32602)
    expect(GET().status).toBe(405)
  })
})
