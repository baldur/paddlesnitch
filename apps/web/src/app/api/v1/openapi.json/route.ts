// GET /api/v1/openapi.json: the API's own description (#511).
import { NextRequest } from 'next/server'
import { openApi } from '@/lib/api-v1-openapi'
import { options } from '@/lib/api-v1'

export const OPTIONS = options

export function GET(req: NextRequest) {
  return Response.json(openApi(req.nextUrl.origin), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  })
}
