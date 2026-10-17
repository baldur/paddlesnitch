// A tiny Markdown reader for our own documents in legal/ (the Terms of
// Service). It knows only what those files use: # and ## headings,
// paragraphs, "- " lists, ---, **bold** and `code`. Anything else stays as
// plain text, so a new construct shows up as text, never as broken markup.

export type Inline = { text: string; bold?: boolean; code?: boolean }
export type Block =
  | { type: 'h1' | 'h2' | 'p'; content: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'hr' }

// Splits a line into plain, **bold** and `code` runs.
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] | null = null
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', content: parseInline(para.join(' ')) })
    if (list) blocks.push({ type: 'ul', items: list.map(parseInline) })
    para = []
    list = null
  }
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    const heading = line.match(/^(#{1,2})\s+(.*)$/)
    const item = line.match(/^[-*]\s+(.*)$/)
    if (!line) flush()
    else if (heading) { flush(); blocks.push({ type: heading[1] === '#' ? 'h1' : 'h2', content: parseInline(heading[2]) }) }
    else if (/^-{3,}$/.test(line)) { flush(); blocks.push({ type: 'hr' }) }
    else if (item) { if (para.length) flush(); (list ??= []).push(item[1]) }
    else if (list) list[list.length - 1] += ' ' + line // a wrapped list item
    else para.push(line)
  }
  flush()
  return blocks
}
