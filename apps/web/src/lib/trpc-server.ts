// Data in the first HTML (docs/features/performance.md, phase 2): a server page
// runs the same tRPC procedures the browser would, in process, and hands the
// answers to the client's query cache. The page then renders with its data
// instead of loading, asking who's signed in, then asking for the data.
//
//   const pre = await prefetch()
//   if (pre.user) await pre.query('paddles.sessions', undefined, c => c.paddles.sessions())
//   return <HydrationBoundary state={pre.state()}><Client /></HydrationBoundary>
//
// Server only: it reads the auth cookie and calls the router directly.
import { QueryClient, dehydrate } from '@tanstack/react-query'
import { createCaller } from '@paddlesnitch/api'
import { getAuthUser } from '@/lib/auth'

type Caller = ReturnType<typeof createCaller>

// The key @trpc/react-query gives `trpc.<path>.useQuery(input)` (checked
// against getQueryKey in trpc-server.test.ts).
export function trpcQueryKey(path: string, input?: unknown) {
  return [path.split('.'), input === undefined ? { type: 'query' } : { input, type: 'query' }] as const
}

export async function prefetch() {
  const user = await getAuthUser()
  const caller = createCaller({ user })
  const client = new QueryClient()
  client.setQueryData(trpcQueryKey('me'), { user })
  return {
    user,
    // A failed procedure (not found, storage hiccup) is left out: the client
    // asks again and shows its own error, as it did before.
    async query<T>(path: string, input: unknown, run: (c: Caller) => Promise<T>): Promise<T | undefined> {
      try {
        const data = await run(caller)
        client.setQueryData(trpcQueryKey(path, input), data)
        return data
      } catch { return undefined }
    },
    state: () => dehydrate(client),
  }
}
