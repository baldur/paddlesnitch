// Help / FAQ content + a tiny parser for it.
//
// The FAQ lives as Markdown at legal/faq.md so it's easy to edit and the
// git history shows content changes as plain diffs — same approach as the
// Terms of Service (legal/tos-*.md). Each question is a `## ` heading; the
// answer is everything until the next `## ` heading. parseFaq turns that
// into structured pairs the page renders. To add a question, edit the
// markdown — no code change needed (the "framework for adding more" the
// product owner asked for in #78).

import { readFile } from 'fs/promises'
import { join } from 'path'

export type FaqEntry = { question: string; answer: string }

// Split the markdown into { question, answer } pairs. `## ` headings start a
// question; everything up to the next `## ` is its answer. Anything before the
// first `## ` (a title or intro) is ignored. Blank lines inside an answer are
// preserved as paragraph breaks.
export function parseFaq(md: string): FaqEntry[] {
  const entries: FaqEntry[] = []
  let current: { question: string; lines: string[] } | null = null

  for (const line of md.split('\n')) {
    const heading = line.match(/^##\s+(.*\S)\s*$/)
    if (heading) {
      if (current) entries.push({ question: current.question, answer: current.lines.join('\n').trim() })
      current = { question: heading[1], lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) entries.push({ question: current.question, answer: current.lines.join('\n').trim() })

  return entries
}

// Splits an answer into display paragraphs. The markdown source is hard-wrapped
// at ~80 columns; those single newlines are soft wraps, not intentional breaks,
// so each paragraph's lines are reflowed into one line (joined with spaces).
// Blank lines separate paragraphs and are the only real break. This keeps the
// rendered page from breaking sentences mid-line the way `whitespace-pre-wrap`
// did — see #81.
export function faqParagraphs(answer: string): string[] {
  return answer
    .split(/\n\s*\n/)
    .map(para => para.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
}

// Reads the raw FAQ markdown. Returns null if the file is missing (the page
// degrades to a "no FAQ" message rather than throwing). Server-side only.
export async function readFaqDoc(): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), 'legal', 'faq.md'), 'utf8')
  } catch {
    return null
  }
}
