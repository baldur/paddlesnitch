import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMarkdown, parseInline } from './markdown-lite'
import { CURRENT_TOS_VERSION } from './types'

describe('parseInline', () => {
  it('splits bold and code out of plain text', () => {
    expect(parseInline('a **b** c `/d`')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' c ' }, { text: '/d', code: true },
    ])
  })
  it('leaves an unclosed ** as plain text', () => {
    expect(parseInline('a ** b')).toEqual([{ text: 'a ** b' }])
  })
})

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, lists and rules', () => {
    const md = '# Title\n\nOne\ntwo.\n\n## Part\n\n- first\n  wrapped\n- **second**\n\n---\n\nEnd.'
    expect(parseMarkdown(md)).toEqual([
      { type: 'h1', content: [{ text: 'Title' }] },
      { type: 'p', content: [{ text: 'One two.' }] },
      { type: 'h2', content: [{ text: 'Part' }] },
      { type: 'ul', items: [[{ text: 'first wrapped' }], [{ text: 'second', bold: true }]] },
      { type: 'hr' },
      { type: 'p', content: [{ text: 'End.' }] },
    ])
  })

  it('leaves no raw Markdown markers in the current Terms of Service', () => {
    const md = readFileSync(join(process.cwd(), 'legal', `tos-${CURRENT_TOS_VERSION}.md`), 'utf8')
    const text = JSON.stringify(parseMarkdown(md))
    expect(text).not.toMatch(/\*\*|"## |"# |"- /)
  })
})
