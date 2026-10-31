// The /games page lists GAMES; the games themselves are static folders under
// games/ at the repo root, deployed to S3 as-is. These keep the two in step.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { GAMES } from './games'

const GAMES_DIR = join(__dirname, '../../../../games')
// Folders under games/ that aren't games.
const NOT_GAMES = new Set(['shared', 'tests'])

describe('games', () => {
  it.each(GAMES.map(g => [g.slug]))('%s has an index.html to serve', slug => {
    expect(existsSync(join(GAMES_DIR, slug, 'index.html'))).toBe(true)
  })

  it('every game folder is listed on /games', () => {
    const folders = readdirSync(GAMES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && !NOT_GAMES.has(d.name))
      .map(d => d.name)
    expect(folders.sort()).toEqual(GAMES.map(g => g.slug).sort())
  })

  it.each(GAMES.map(g => [g.slug]))('%s counts its visits', slug => {
    const html = readFileSync(join(GAMES_DIR, slug, 'index.html'), 'utf8')
    expect(html).toContain('<script src="../shared/analytics.js" defer></script>')
  })

  it("brings a player back to the river game's own address after sign-in, not the old /games/kayak/", async () => {
    const { SIGN_IN } = await import('../../../../games/reading-thames/account.js')
    const game = GAMES.find(g => g.slug === 'reading-thames')!
    expect(SIGN_IN).toBe(`/signin?next=${game.href}`)
  })

  it('links each game by its folder, with the trailing slash its relative imports need', () => {
    expect(GAMES.map(g => g.href)).toEqual(GAMES.map(g => `/games/${g.slug}/`))
  })
})
