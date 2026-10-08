import { describe, it, expect } from 'vitest'
import { getQueryKey } from '@trpc/react-query'
import { trpc } from '@/lib/trpc'
import { trpcQueryKey } from './trpc-server'

// If @trpc/react-query ever changes its key shape, a prefilled answer would be
// silently ignored and the page would fetch again: this catches that.
describe('trpcQueryKey', () => {
  it('matches the key useQuery uses, with and without input', () => {
    expect(trpcQueryKey('me')).toEqual(getQueryKey(trpc.me, undefined, 'query'))
    expect(trpcQueryKey('paddles.sessions')).toEqual(getQueryKey(trpc.paddles.sessions, undefined, 'query'))
    expect(trpcQueryKey('paddles.get', { id: 'p1' })).toEqual(getQueryKey(trpc.paddles.get, { id: 'p1' }, 'query'))
  })
})
