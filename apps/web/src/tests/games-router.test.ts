// The CloudFront Function in front of /games/* (the games live in their own
// repo and are synced to S3 by its upload.sh). S3 has no directory index and
// the games load siblings with relative URLs, so the function must map a
// folder to its index.html and add the slash a bare folder URL is missing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// A CloudFront Function is a plain script defining `handler`, not a module.
const code = readFileSync(join(__dirname, '../../../../infra/functions/games-router.js'), 'utf8')
type Req = { uri: string; querystring?: Record<string, { value: string }> }
type Res = { statusCode: number; headers: Record<string, { value: string }> }
const handler = new Function(`${code}; return handler`)() as (e: { request: Req }) => Req | Res

const run = (uri: string, querystring = {}) => handler({ request: { uri, querystring } })

describe('games router', () => {
  it('serves index.html for a folder URL', () => {
    expect((run('/games/kayak/') as Req).uri).toBe('/games/kayak/index.html')
  })

  it('redirects a folder URL without its slash, so relative imports resolve', () => {
    const res = run('/games/kayak') as Res
    expect(res.statusCode).toBe(301)
    expect(res.headers.location.value).toBe('/games/kayak/')
  })

  it('keeps the query string on that redirect', () => {
    const res = run('/games/kayak', { seed: { value: '42' } }) as Res
    expect(res.headers.location.value).toBe('/games/kayak/?seed=42')
  })

  it('passes files through untouched', () => {
    expect((run('/games/shared/audio.js') as Req).uri).toBe('/games/shared/audio.js')
  })
})
