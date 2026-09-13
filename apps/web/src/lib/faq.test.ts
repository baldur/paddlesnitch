import { describe, it, expect } from 'vitest'
import { parseFaq, readFaqDoc, faqParagraphs } from './faq'

describe('parseFaq', () => {
  it('splits a markdown doc into question/answer pairs on ## headings', () => {
    const md = [
      '## Do I need to trim my GPS file?',
      'No — upload your whole session.',
      '',
      '## What formats can I upload?',
      'GPX, FIT, CSV, or a direct Strava import.',
      '',
    ].join('\n')

    const faq = parseFaq(md)
    expect(faq).toEqual([
      { question: 'Do I need to trim my GPS file?', answer: 'No — upload your whole session.' },
      { question: 'What formats can I upload?', answer: 'GPX, FIT, CSV, or a direct Strava import.' },
    ])
  })

  it('keeps multi-paragraph answers together', () => {
    const md = [
      '## Why wasn’t my time recorded?',
      'Your track did not cross the start/finish lines.',
      '',
      'The upload page shows a diagnostic map of your track.',
    ].join('\n')

    const faq = parseFaq(md)
    expect(faq).toHaveLength(1)
    expect(faq[0].answer).toBe(
      'Your track did not cross the start/finish lines.\n\nThe upload page shows a diagnostic map of your track.'
    )
  })

  it('ignores leading preamble before the first question', () => {
    const md = ['# FAQ', 'Some intro text.', '', '## A real question?', 'A real answer.'].join('\n')
    const faq = parseFaq(md)
    expect(faq).toEqual([{ question: 'A real question?', answer: 'A real answer.' }])
  })

  it('returns an empty array for a doc with no questions', () => {
    expect(parseFaq('just some prose, no headings')).toEqual([])
  })
})

describe('faqParagraphs', () => {
  it('reflows a hard-wrapped paragraph into a single line (no premature breaks)', () => {
    // legal/faq.md is hard-wrapped at ~80 cols; those source newlines must
    // not surface as mid-sentence line breaks in the rendered page (#81).
    const answer = [
      'Public courses and their trials are visible to anyone, so your',
      'times may become public.',
    ].join('\n')

    expect(faqParagraphs(answer)).toEqual([
      'Public courses and their trials are visible to anyone, so your times may become public.',
    ])
  })

  it('keeps blank-line-separated paragraphs as distinct entries', () => {
    const answer = [
      'Your track did not cross the start/finish',
      'lines.',
      '',
      'The upload page shows a diagnostic map of',
      'your track.',
    ].join('\n')

    expect(faqParagraphs(answer)).toEqual([
      'Your track did not cross the start/finish lines.',
      'The upload page shows a diagnostic map of your track.',
    ])
  })

  it('collapses runs of blank lines and ignores trailing whitespace', () => {
    expect(faqParagraphs('One.\n\n\n\nTwo.\n')).toEqual(['One.', 'Two.'])
  })

  it('returns an empty array for an empty answer', () => {
    expect(faqParagraphs('')).toEqual([])
  })
})

describe('readFaqDoc', () => {
  it('reads the seeded FAQ markdown and parses to at least the seed questions', async () => {
    const body = await readFaqDoc()
    expect(body).not.toBeNull()
    const faq = parseFaq(body as string)
    expect(faq.length).toBeGreaterThanOrEqual(5)
    // The "do I need to trim" answer is the single most-asked question.
    expect(faq.some(q => /trim/i.test(q.question))).toBe(true)
  })
})
