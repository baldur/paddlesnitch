// Fetching a source for the weekly refresh: a dropped connection or a busy
// server (5xx) gets two more tries, a 4xx is an answer. When it still fails,
// say why: Node's fetch throws "fetch failed" and hides the reason (a
// timeout, a refused connection, DNS) in `cause` (#559).

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

export async function fetchWithRetry(url: string, init: RequestInit = {},
  { tries = 3, delayMs = 5000, fetchImpl = fetch as FetchImpl }: { tries?: number; delayMs?: number; fetchImpl?: FetchImpl } = {}): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetchImpl(url, init)
      if (res.status < 500 || i >= tries) return res
    } catch (e) {
      if (i >= tries) throw e
    }
    await new Promise(r => setTimeout(r, delayMs * i))
  }
}

/** The error's message, with Node's hidden cause when there is one. */
export function fetchError(e: unknown): string {
  const err = e as Error & { cause?: Error & { code?: string } }
  const cause = err.cause
  return cause ? `${err.message} (${[cause.code, cause.message].filter(Boolean).join(': ')})` : err.message
}
