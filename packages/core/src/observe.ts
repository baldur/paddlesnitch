// Operational telemetry (docs/features/observability.md): which client made a
// request, one line per API call, one line per action. Every line is an EMF
// document, so CloudWatch makes the alarm metrics straight from it and Logs
// Insights sees every property. Never user ids, input or error messages.

export type Platform = 'web' | 'android' | 'ios' | 'tracker' | 'server' | 'other'
export type Client = { platform: Platform; version?: string; build?: string }

// The header the apps already send (APP_HEADER in ./auth, which also makes
// sign-in answer with tokens): `android/0.1.0`, optionally with the store
// build, `android/1.0.3 (42)`. Not imported from ./auth, which pulls in
// next/headers and the Cognito SDK.
export const CLIENT_HEADER = 'x-paddlesnitch-app'
const APP_CLIENT = /^(android|ios)\/(\d{1,4}(?:\.\d{1,4}){0,3})(?: \((\d{1,9})\))?$/

/** No header is the web site. A header that isn't a well-formed app client is
 *  `other`, so a junk header can't add values to the dashboards. */
export function clientOf(headers: Headers): Client {
  const raw = headers.get(CLIENT_HEADER)
  if (raw == null) return { platform: 'web' }
  const m = APP_CLIENT.exec(raw.trim())
  if (!m) return { platform: 'other' }
  return { platform: m[1] as Platform, version: m[2], ...(m[3] ? { build: m[3] } : {}) }
}

const clientProps = (c?: Client) => (c ? {
  platform: c.platform,
  ...(c.version ? { appVersion: c.version } : {}),
  ...(c.build ? { build: c.build } : {}),
} : {})

// tRPC codes that mean we broke something. The rest (UNAUTHORIZED, NOT_FOUND,
// BAD_REQUEST, ...) are the caller asking for something wrong: logged, never
// counted as an error.
const SERVER_CODES = new Set(['INTERNAL_SERVER_ERROR', 'TIMEOUT', 'NOT_IMPLEMENTED', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE', 'GATEWAY_TIMEOUT'])
export const isServerErrorCode = (code: string) => SERVER_CODES.has(code)

export type ApiCall = { path: string; type: string; code?: string; ms: number }

export function apiCallEmf(call: ApiCall, client?: Client, timestamp: number = Date.now()) {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{
        Namespace: 'Paddlesnitch/Api',
        Dimensions: [[]],
        Metrics: [{ Name: 'Calls', Unit: 'Count' }, { Name: 'ServerErrors', Unit: 'Count' }],
      }],
    },
    kind: 'api_call',
    Calls: 1,
    ServerErrors: call.code && isServerErrorCode(call.code) ? 1 : 0,
    path: call.path,
    type: call.type,
    ok: !call.code,
    ...(call.code ? { code: call.code } : {}),
    ms: Math.round(call.ms),
    ...clientProps(client),
  }
}

// An action is something a user does that we care about succeeding. `rejected` is the
// user's input being refused (a wrong password, a trace that misses the
// start line): expected, not counted. `fail` means we let them down.
export type Action = 'sign_in' | 'upload' | 'analyse' | 'device_sync' | 'strava_import'
export type Outcome = 'ok' | 'rejected' | 'fail'

export function actionEmf(action: Action, outcome: Outcome, opts: { client?: Client; reason?: string } = {}, timestamp: number = Date.now()) {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{
        Namespace: 'Paddlesnitch/Actions',
        // Per action, and in total (the zero-tolerance alarm watches the total).
        Dimensions: [['Action'], []],
        Metrics: [{ Name: 'Attempts', Unit: 'Count' }, { Name: 'Failures', Unit: 'Count' }],
      }],
    },
    kind: 'action',
    Action: action,
    Attempts: 1,
    Failures: outcome === 'fail' ? 1 : 0,
    outcome,
    ...(opts.reason ? { reason: opts.reason.slice(0, 60) } : {}),
    ...clientProps(opts.client),
  }
}

// Never throw: telemetry must not break a request.
const emit = (doc: object) => { try { console.log(JSON.stringify(doc)) } catch { /* ignore */ } }
export const logApiCall = (call: ApiCall, client?: Client) => emit(apiCallEmf(call, client))
export const logAction = (action: Action, outcome: Outcome, opts?: { client?: Client; reason?: string }) =>
  emit(actionEmf(action, outcome, opts))
