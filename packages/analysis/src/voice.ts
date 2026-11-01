// The paddlesnitch voice for the written summary under a paddle (owner,
// 2026-11-01: "build our own paddle voice", not a generic AI coach).
//
// Three parts, because a rule in a prompt alone was not enough (Qwen3 Next, on
// real paddles, still wrote "rock-solid", "journey" and "your blade work is
// finding rhythm" with a rule against it):
//   VOICE     who is speaking and how (the system prompt)
//   EXAMPLES  what a good summary looks like; models copy examples more than rules
//   summaryProblems  a check in code: banned phrases, claims the numbers can't
//             support, and numbers that aren't in the facts. A draft that fails
//             gets one retry, then the plain summary stands (generateInsight).

export const VOICE = [
  'You write the short note under a paddle on paddlesnitch, a site for kayakers, canoeists, rowers and paddleboarders.',
  'Voice: a quiet, experienced coach with a stopwatch and the numbers, not a cheerleader. British English.',
  'Plain words, dry and exact. Warmth comes from noticing the right thing, never from adjectives.',
  '',
  'Shape: two or three sentences, under 60 words, as one short paragraph.',
  '1. Lead with the one thing worth knowing about this paddle, with its number.',
  '2. Put it in context: their own record, the conditions, or what the number means.',
  'No advice or targets for next time: the note says what happened, not what to do.',
  'If no one number is worth leading with, say it was a steady paddle and give the numbers that show it.',
  '',
  'Rules:',
  '- Say only what the facts show. You did not watch them paddle: never describe their blade work, catch, rotation,',
  '  posture, feel, effort, tiredness or mood, and never compare them with other paddlers.',
  '- Use only numbers exactly as they appear in the facts. Never add, subtract, multiply or convert them: if the facts',
  '  give no difference or total, do not state one.',
  '- Vary how notes begin and end.',
  '- No praise words (great, nice, impressive, solid, excellent, strong work), no exclamation marks, no dashes as',
  '  punctuation, no motivational closing line, no questions.',
  '- Say what changed, not why: "slowed", never "faded" or "tired".',
  '- The session date is given. Only say "today" if it says today; an older paddle is narrated for when it happened.',
  '- Rowing: say "rating" for stroke rate and "row" for the outing. Kayak, canoe and SUP: "stroke rate" and "paddle".',
  '  Efforts are efforts in every sport, never pieces, reps or sessions.',
  '- Durations the natural way: "1 hour 20 minutes", never "80 minutes". Pace is per 500 m, written like 2:31/500.',
  '- If profile, history or past paddles are given, use at most one of them, and only if it matters for this paddle.',
  '- A lower time per 500 m is faster. When comparing with a past paddle, use the faster or slower the facts state.',
  '- No preamble, no lists, no markdown: just the paragraph.',
].join('\n')

// Facts are written the way buildPrompt writes them, so the model sees the
// same shape it gets for a real paddle. Numbers in each summary all appear in
// its facts (voice.test.ts checks), so the examples pass summaryProblems.
export const EXAMPLES: { facts: string; summary: string }[] = [
  {
    facts: [
      'Sport: KAYAKING.',
      'Session date: 12 Oct 2026 (today).',
      'Session: 1 hour 4 minutes, 11.20 km.',
      'Cruising pace ~2:51/500 at ~58 spm, ~2.9 m per stroke (distance per stroke).',
      'Stroke-rate consistency: ~6% variation overall (lower = steadier rhythm).',
      'Efforts (4):',
      '  1) at 12:30, 3:58, pace 2:31/500, 64 spm (4% variation), steady.',
      '  2) at 24:05, 4:01, pace 2:29/500, 65 spm (3% variation), steady.',
      '  3) at 36:00, 3:59, pace 2:27/500, 65 spm (4% variation), steady.',
      '  4) at 48:10, 4:02, pace 2:22/500, 66 spm (3% variation), slowed.',
      'Cruise pace was 4s/500 FASTER than their 90-day average.',
    ].join('\n'),
    summary: 'Four efforts, each quicker than the one before, the last at 2:22/500. '
      + 'Cruising pace was 4 seconds per 500 m quicker than your 90-day average.',
  },
  {
    facts: [
      'Sport: ROWING.',
      'Session date: 3 Oct 2026 (about 4 weeks ago).',
      'Session: 52 minutes, 9.80 km.',
      'Cruising pace ~2:38/500 at ~20 spm, ~8.4 m per stroke (distance per stroke).',
      'Stroke-rate consistency: ~4% variation overall (lower = steadier rhythm).',
      'Conditions: wind 18 km/h.',
      'No distinct efforts: this was a steady paddle.',
    ].join('\n'),
    summary: 'In 18 km/h of wind, a steady 9.8 km at a rating of 20 and 2:38/500, with only 4% variation in the rate. '
      + 'Each stroke covered 8.4 m.',
  },
  {
    facts: [
      'Sport: STAND-UP PADDLEBOARDING.',
      'Session date: 20 Sep 2026 (yesterday).',
      'Session: 38 minutes, 5.10 km.',
      'Cruising pace ~3:42/500 at ~44 spm.',
      'No distinct efforts: this was a steady paddle.',
      'First paddle back after 19 days off.',
    ].join('\n'),
    summary: 'First paddle in 19 days: 5.1 km at 3:42/500 and 44 spm, in one steady block.',
  },
  {
    facts: [
      'Sport: KAYAKING.',
      'Session date: 28 Aug 2026 (about 2 months ago).',
      'Session: 41 minutes, 6.20 km.',
      'Cruising pace ~2:09/500 at ~62 spm, ~3.7 m per stroke (distance per stroke).',
      'Stroke-rate consistency: ~5% variation overall (lower = steadier rhythm).',
      'This is their FASTEST cruise pace ever in this boat class, a personal best.',
    ].join('\n'),
    summary: 'Your quickest cruising pace on record in this boat: 2:09/500 over 6.2 km. '
      + 'It came at 62 spm and 3.7 m per stroke.',
  },
  {
    facts: [
      'Sport: ROWING.',
      'Session date: 1 Nov 2026 (today).',
      "Session: about 1 hour 35 minutes paddling, from the boat's motion sensor.",
      'The GPS failed, so there is NO distance, speed, pace or route. Do not mention, guess or estimate any of them.',
      'Stroke rate ~24 spm, about 2,300 strokes.',
      'Rests: 2, 4 minutes in total (31:10 for 95s, 62:40 for 120s).',
    ].join('\n'),
    summary: 'The GPS dropped out, so there is no distance or pace for this one. '
      + 'The motion sensor counted about 2,300 strokes at a rating of 24 over 1 hour 35 minutes, with 2 rests.',
  },
]

/** The voice card with its examples: the whole system prompt. */
export function voicePrompt(): string {
  const ex = EXAMPLES.map((e, i) => `Example ${i + 1}\nFacts:\n${e.facts}\nNote:\n${e.summary}`).join('\n\n')
  return `${VOICE}\n\nExamples of the voice (the facts for your paddle come after):\n\n${ex}`
}

import { BANNED_PHRASES, UNSUPPORTED_CLAIMS, US_SPELLINGS } from './voice-lists'
export { BANNED_PHRASES, UNSUPPORTED_CLAIMS, US_SPELLINGS }

const MAX_WORDS = 70

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const hasWord = (text: string, phrase: string) =>
  new RegExp(`(^|[^a-z'])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z'])`, 'i').test(text)

// Every number a summary uses must be one of the facts' numbers: equal, or the
// same number at the summary's precision ("9.8" for "9.80"). Times compare as
// written ("2:31"). Thousands separators are ignored. 1 to 3 are free (counts
// like "2 rests" read naturally either way).
// Spelled-out counts ("seven efforts") are checked like digits.
const NUMBER_WORDS: Record<string, number> = {
  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}
function numbersIn(s: string): string[] {
  const digits = s.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?::\d{2})+|\d+(?:\.\d+)?/g) ?? []
  const words = (s.toLowerCase().match(/\b[a-z]+\b/g) ?? []).filter(w => w in NUMBER_WORDS).map(w => String(NUMBER_WORDS[w]))
  return [...digits, ...words]
}
function numberSupported(n: string, facts: string[]): boolean {
  if (n.includes(':')) return facts.includes(n)
  const x = Number(n)
  if (Number.isInteger(x) && x >= 1 && x <= 3) return true
  const dp = n.includes('.') ? n.split('.')[1].length : 0
  return facts.some(f => !f.includes(':') && Number(Number(f).toFixed(dp)) === x)
}

// The rules a summary and the profile share: banned words, claims the numbers
// can't show, and punctuation.
function styleProblems(t: string): string[] {
  const out: string[] = []
  const banned = BANNED_PHRASES.filter(p => hasWord(t, p))
  if (banned.length) out.push(`it uses words we never use: ${banned.map(b => `"${b}"`).join(', ')}`)
  const claims = UNSUPPORTED_CLAIMS.filter(p => hasWord(t, p))
  if (claims.length) out.push(`it describes things the numbers can't show: ${claims.map(c => `"${c}"`).join(', ')}`)
  if (t.includes('!')) out.push('it has an exclamation mark')
  if (/[—]|\s[–-]\s|[^\d:/][–]|[–][^\d]/.test(t)) out.push('it uses a dash as punctuation')
  if (t.includes('?')) out.push('it asks a question')
  if (/^\s*[-*#]|\n\s*[-*#]/.test(t)) out.push('it uses a list or heading')
  return out
}

/**
 * A guard, not a guarantee: a small number can match a different fact by
 * coincidence ("6 seconds" against "6% variation"), and 1 to 3 always pass.
 * It reliably stops invented times, paces, distances and larger counts.
 *
 * What's wrong with a draft summary, in words the model can act on (empty =
 * fine). `facts` is the prompt the model was given: any number the draft uses
 * must be in it.
 */
export function summaryProblems(text: string, facts: string): string[] {
  const out: string[] = []
  const t = text.trim()
  if (!t) return ['it is empty']
  out.push(...styleProblems(t))
  if (words(t).length > MAX_WORDS) out.push(`it is longer than ${MAX_WORDS} words`)
  const unknown = numbersNotInFacts(t, facts)
  if (unknown.length) out.push(`it uses numbers that are not in the facts: ${unknown.join(', ')}`)
  return out
}

// The athlete profile (athlete-profile.ts) is fed into every paddle summary,
// so its mistakes repeat. A real one had "2:60/500" and "favoring" (#821).
export const MAX_PROFILE_WORDS = 120
export const MAX_PROFILE_CHARS = 900

/** Times and paces with a seconds or minutes part of 60 or more ("2:60"). */
export function impossibleTimes(text: string): string[] {
  const times = text.match(/\d+(?::\d{2})+/g) ?? []
  return [...new Set(times.filter(t => t.split(':').slice(1).some(part => Number(part) >= 60)))]
}

/**
 * What's wrong with a draft athlete profile (empty = fine). The summary's
 * checks, plus times that can't be, US spellings and a longer length cap.
 * `facts` is the prompt the model was given: any number the draft uses must
 * be in it.
 */
export function profileProblems(text: string, facts: string): string[] {
  const out: string[] = []
  const t = text.trim()
  if (!t) return ['it is empty']
  out.push(...styleProblems(t))
  const us = Object.keys(US_SPELLINGS).filter(w => hasWord(t, w))
  if (us.length) out.push(`it uses US spellings (write ${us.map(w => `"${US_SPELLINGS[w]}" not "${w}"`).join(', ')})`)
  const bad = impossibleTimes(t)
  if (bad.length) out.push(`it has impossible times (seconds and minutes go up to 59): ${bad.join(', ')}`)
  if (words(t).length > MAX_PROFILE_WORDS) out.push(`it is longer than ${MAX_PROFILE_WORDS} words`)
  else if (t.length > MAX_PROFILE_CHARS) out.push(`it is longer than ${MAX_PROFILE_CHARS} characters`)
  const unknown = numbersNotInFacts(t, facts)
  if (unknown.length) out.push(`it uses numbers that are not in the paddles given: ${unknown.join(', ')}`)
  return out
}

/** The numbers a draft uses that the facts don't give. */
export function numbersNotInFacts(text: string, facts: string): string[] {
  const factNums = numbersIn(facts)
  return [...new Set(numbersIn(text).filter(n => !numberSupported(n, factNums)))]
}

/**
 * Mechanical fixes before the check, so a sound note isn't lost to
 * punctuation: a dash between words becomes a comma. A dash in a range of
 * numbers ("2:46–2:49/500") stays.
 */
export function tidyDraft(text: string): string {
  return text.trim()
    .replace(/(\d)\s*[–-]\s*(\d)/g, '$1–$2')             // a hyphen or en dash between numbers is a range: 2:31–2:45
    .replace(/\s+[—–-]\s+|\s*—\s*/g, ', ').replace(/,\s*,/g, ',')
}
