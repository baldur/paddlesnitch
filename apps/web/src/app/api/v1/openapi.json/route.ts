// GET /api/v1/openapi.json: the API's own description (#511).
import { NextRequest } from 'next/server'
import { openApi } from '@/lib/api-v1-openapi'
import { options } from '@/lib/api-v1'
import { canonicalBaseUrl } from '@paddlesnitch/core/url'

export const OPTIONS = options

export function GET(req: NextRequest) {
  return Response.json(openApi(canonicalBaseUrl(req)), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  })
}
