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
    expect((run('/games/reading-thames/') as Req).uri).toBe('/games/reading-thames/index.html')
  })

  it('redirects a folder URL without its slash, so relative imports resolve', () => {
    const res = run('/games/reading-thames') as Res
    expect(res.statusCode).toBe(301)
    expect(res.headers.location.value).toBe('/games/reading-thames/')
  })

  it('keeps the query string on that redirect', () => {
    const res = run('/games/reading-thames', { seed: { value: '42' } }) as Res
    expect(res.headers.location.value).toBe('/games/reading-thames/?seed=42')
  })

  it('sends the old /games/kayak/ address to /games/reading-thames/, query kept (a #race= link survives: browsers carry the fragment)', () => {
    for (const [from, to] of [
      ['/games/kayak/', '/games/reading-thames/'],
      ['/games/kayak', '/games/reading-thames/'],
      ['/games/kayak/index.html', '/games/reading-thames/index.html'],
      ['/games/kayak/courses/loop.json', '/games/reading-thames/courses/loop.json'],
    ]) {
      const res = run(from) as Res
      expect(res.statusCode, from).toBe(301)
      expect(res.headers.location.value, from).toBe(to)
    }
    expect((run('/games/kayak/', { seed: { value: '42' } }) as Res).headers.location.value).toBe('/games/reading-thames/?seed=42')
    expect((run('/games/kayaking/') as Req).uri).toBe('/games/kayaking/index.html') // only that folder
  })

  it('sends the games folder itself to the /games page', () => {
    const res = run('/games/') as Res
    expect(res.statusCode).toBe(301)
    expect(res.headers.location.value).toBe('/games')
  })

  it('passes files through untouched', () => {
    expect((run('/games/shared/audio.js') as Req).uri).toBe('/games/shared/audio.js')
  })
})
