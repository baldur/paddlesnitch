import { LLMS_TXT } from '@/lib/discovery'

// What the site is and how to use it, for AI assistants (llmstxt.org, #513).
export function GET() {
  return new Response(LLMS_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
