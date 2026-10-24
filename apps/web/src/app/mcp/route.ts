// A read-only MCP server (#512) so AI assistants can plan paddles and read
// public trials. Streamable HTTP, stateless, no auth: each POST is one
// JSON-RPC message answered with one JSON response. The tools call the public
// /api/v1 handlers in-process, so they return exactly what the API returns.
// Hand-rolled (four methods) rather than a dependency; see src/lib/mcp.ts.
import { NextRequest } from 'next/server'
import { handleMcp, MCP_CORS } from '@/lib/mcp'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let msg: unknown
  try { msg = await req.json() } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: MCP_CORS })
  }
  const reply = await handleMcp(msg, req.nextUrl.origin)
  // A notification (no id) gets no body.
  return reply ? Response.json(reply, { headers: MCP_CORS }) : new Response(null, { status: 202, headers: MCP_CORS })
}

// No server-to-client stream: this server never sends anything unasked.
export const GET = () => new Response('This MCP server answers POSTed JSON-RPC only.', { status: 405, headers: { ...MCP_CORS, Allow: 'POST' } })

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...MCP_CORS, 'Access-Control-Max-Age': '86400' } })
