// The read-only MCP server's protocol (#512): initialize, ping, tools/list and
// tools/call over JSON-RPC 2.0. Each tool is one /api/v1 GET, called
// in-process with the tool's arguments as query parameters, so a tool returns
// what the API returns (shape, errors, attribution) and can't drift from it.
import { NextRequest } from 'next/server'
import { GET as plan } from '@/app/api/v1/plan/route'
import { GET as places } from '@/app/api/v1/places/route'
import { GET as trials } from '@/app/api/v1/trials/route'
import { GET as trial } from '@/app/api/v1/trials/[trialId]/route'
import { GET as leaderboard } from '@/app/api/v1/trials/[trialId]/leaderboard/route'

export const MCP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
}

/** Newest first; we answer in the client's version when we know it. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

type Json = Record<string, unknown>
type Tool = {
  name: string
  title: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, Json>; required?: string[] }
  call: (args: Json, origin: string) => Promise<Response>
}

const str = (description: string) => ({ type: 'string', description })
const query = (path: string, args: Json, origin: string) => {
  const url = new URL(path, origin)
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  return new NextRequest(url)
}
const params = (trialId: unknown) => ({ params: Promise.resolve({ trialId: String(trialId ?? '') }) })

export const TOOLS: Tool[] = [
  {
    name: 'search_places',
    title: 'Find places on the water',
    description: 'Find locks, wharves, slipways, portages and towns on UK, Irish and western European rivers and canals by name. Use it to choose the ends of a plan.',
    inputSchema: { type: 'object', properties: { q: str('Name to search for, e.g. "Cropredy".'), near: str('Optional "lat,lng": nearer matches first.'), waterway: str('Optional: only places on this waterway.') }, required: ['q'] },
    call: (a, o) => places(query('/api/v1/places', a, o)),
  },
  {
    name: 'plan_route',
    title: 'Plan a paddle',
    description: 'Plan a paddle between two points on the water: distance, time at a pace, and every lock, weir, portage, access point and facility on the way, with arrival times. Ends are "lat,lng" or a place name. Show the attribution with the data. For planning only, not navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        from: str('Start: "lat,lng" or a place name such as "Cropredy Lock".'),
        to: str('Finish (or the turning point of a return trip): "lat,lng" or a place name.'),
        waterway: str('Optional: keep named ends on this waterway, e.g. "oxford-canal".'),
        shape: { type: 'string', enum: ['one_way', 'return'], description: 'return: out to `to` and back. Default one_way.' },
        pace: { type: 'number', minimum: 1, maximum: 30, description: 'Moving pace in km/h. Default 8.' },
        portage: { type: 'number', minimum: 0, maximum: 120, description: 'Minutes added per portage. Default 3.' },
        at: str('Optional start time, ISO 8601 with an offset; every stop then gets an eta.'),
      },
      required: ['from', 'to'],
    },
    call: (a, o) => plan(query('/api/v1/plan', a, o)),
  },
  {
    name: 'list_trials',
    title: 'Public time trials',
    description: 'List public GPS-timed paddling and rowing time trials, newest first, each with its course.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed'], description: 'Optional filter.' } } },
    call: (a, o) => trials(query('/api/v1/trials', a, o)),
  },
  {
    name: 'get_trial',
    title: 'One public time trial',
    description: 'A public time trial and its course (start and finish lines or gates, distance).',
    inputSchema: { type: 'object', properties: { trial_id: str('The trial id, from list_trials.') }, required: ['trial_id'] },
    call: (a, o) => trial(query(`/api/v1/trials/${encodeURIComponent(String(a.trial_id))}`, {}, o), params(a.trial_id)),
  },
  {
    name: 'get_leaderboard',
    title: 'A public trial’s results',
    description: 'Results of a public time trial, fastest first: names, boat classes, times and 500 m splits.',
    inputSchema: { type: 'object', properties: { trial_id: str('The trial id, from list_trials.'), boat_class: str('Optional, e.g. K1, 1X, 8+.') }, required: ['trial_id'] },
    call: (a, o) => leaderboard(query(`/api/v1/trials/${encodeURIComponent(String(a.trial_id))}/leaderboard`, { boat_class: a.boat_class }, o), params(a.trial_id)),
  },
]

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** One JSON-RPC message in, its response out (null for a notification). */
export async function handleMcp(msg: unknown, origin: string): Promise<Json | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request: send one JSON-RPC object')
  const { id, method, params: p } = msg as { id?: unknown; method?: unknown; params?: Json }
  if (typeof method !== 'string') return rpcError(id, -32600, 'Invalid Request')
  if (id === undefined) return null   // notifications/initialized and the like: nothing to say
  const result = (r: Json) => ({ jsonrpc: '2.0', id, result: r })

  switch (method) {
    case 'initialize': {
      const asked = typeof p?.protocolVersion === 'string' ? p.protocolVersion : ''
      return result({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'paddlesnitch', title: 'paddlesnitch', version: '1.0.0' },
        instructions: 'Read-only paddling data: plan routes on rivers and canals (UK, Ireland and much of western Europe) and read public time trials. Show the attribution each result carries. For planning only: paddlesnitch is not a navigation authority.',
      })
    }
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: TOOLS.map(({ call: _call, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } })) })
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === p?.name)
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(p?.name)}`)
      const args = (p?.arguments && typeof p.arguments === 'object' ? p.arguments : {}) as Json
      const missing = (tool.inputSchema.required ?? []).filter(k => args[k] === undefined || args[k] === '')
      if (missing.length) return result({ content: [{ type: 'text', text: `Missing: ${missing.join(', ')}` }], isError: true })
      const res = await tool.call(args, origin)
      const body = await res.json() as Json
      return result({
        content: [{ type: 'text', text: JSON.stringify(body) }],
        ...(res.ok ? { structuredContent: body } : {}),
        isError: !res.ok,
      })
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}
