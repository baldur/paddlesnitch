// The contract README's Boat motion section quotes the website's words for
// the apps to copy. Each quoted phrase must still be on the website, or the
// apps would ship words the website has dropped.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.join(__dirname, '../../../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const readme = read('mobile/contract/README.md')
const section = readme.slice(readme.indexOf('### Boat motion'), readme.indexOf('Your name and sign-in email come from `me`.'))
// What the website renders these from, with JSX's escapes undone.
const site = [
  'apps/web/src/components/devices/BoatMotion.tsx',
  'apps/web/src/app/paddles/[id]/motion/page.tsx',
  'apps/web/src/lib/tracker-copy.ts',
].map(read).join('\n').replace(/<\/?span[^>]*>/g, '').replace(/&apos;/g, "'").replace(/\{' '\}/g, ' ').replace(/\s+/g, ' ')

// Templates and examples, not words on the screen.
// Spoken forms for screen readers are the apps' own (the website has none).
const NOT_WORDS = /\bN\b|<|^x-|^-6°$|^\+N°$|^−N°$|^0 min$|^what you have is|^at … Hz$|^degrees$|^strokes per minute$/

describe("the contract README's boat-motion words are the website's", () => {
  const quoted = [...section.matchAll(/"([^"]+)"/g)].map(m => m[1].replace(/\*\*/g, '').trim())
    .filter(q => !NOT_WORDS.test(q) && q !== 'device')
  it('finds the quotes', () => expect(quoted.length).toBeGreaterThan(25))
  for (const q of quoted) it(q, () => expect(site).toContain(q.replace(/\s+/g, ' ')))
})
