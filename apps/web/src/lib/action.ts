import { clientOf, logAction, type Client, type Action, type Outcome } from '@paddlesnitch/core/observe'

// How a route's answer reads as an action (docs/features/observability.md):
// 2xx/3xx worked; 4xx is the user's input refused, which is expected; 5xx is us.
export function outcomeOfStatus(status: number): Outcome {
  if (status >= 500) return 'fail'
  if (status >= 400) return 'rejected'
  return 'ok'
}

/** Wrap a route handler so every request logs one action line. A throw is a
 *  `fail` and is rethrown unchanged. `client` overrides the request's own
 *  (a tracker doesn't send the app header). */
export function withAction<R extends Request, A extends unknown[]>(
  action: Action,
  handler: (req: R, ...rest: A) => Promise<Response>,
  client?: Client,
) {
  return async (req: R, ...rest: A): Promise<Response> => {
    const who = client ?? clientOf(req.headers)
    try {
      const res = await handler(req, ...rest)
      const outcome = outcomeOfStatus(res.status)
      logAction(action, outcome, { client: who, reason: outcome === 'ok' ? undefined : `http_${res.status}` })
      return res
    } catch (e) {
      logAction(action, 'fail', { client: who, reason: 'threw' })
      throw e
    }
  }
}
