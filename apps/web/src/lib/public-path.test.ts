// Paths recorded in analytics (CloudWatch, kept for months) and put in feedback
// issues (a PUBLIC GitHub repo) must not carry who someone is or a secret:
// a share id in a public issue publishes that paddle's full route (privacy
// audit 2026-09). Public ids that aren't about a person stay, because "which
// trial do people look at" is the point of the analytics.
import { describe, it, expect } from 'vitest'
import { publicPath } from '@paddlesnitch/ui/metrics-events'

describe('publicPath', () => {
  it.each([
    ['/paddles/shared/Xy12abC_9', '/paddles/shared/[id]'],
    ['/paddles/k3j4h5', '/paddles/[id]'],
    ['/profile/baldur', '/profile/[id]'],
    ['/devices/435C09C8', '/devices/[id]'],
    ['/devices/435C09C8/s_abc', '/devices/[id]/[id]'],
    ['/l/K7P2QM', '/l/[code]'],
    ['/L/K7P2QM', '/L/[code]'],
  ])('%s → %s', (raw, want) => expect(publicPath(raw)).toBe(want))

  it.each([
    '/', '/paddles', '/paddles/new', '/paddles/compare', '/paddles/compare/section',
    '/profile/me', '/devices', '/account', '/guide/wifi', '/att/trials/abc123', '/att/courses/c1',
  ])('keeps %s', p => expect(publicPath(p)).toBe(p))
})
