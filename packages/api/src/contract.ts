// The mobile apps' API contract (docs/features/mobile-apps.md, phase C1): zod
// schemas for the procedures the Android and iPhone apps call, from which
// `pnpm mobile:contract` writes JSON Schema into mobile/contract/api/. The apps
// generate their own models from that JSON, never from this file.
//
// These schemas are NOT attached to the procedures with `.output()`: stored
// paddles go back years and some lack fields the types now have, and runtime
// output validation would turn that into a 500 on the website. Instead the
// type checks at the bottom fail `pnpm typecheck` whenever a schema and what
// the procedure actually returns stop matching, and the contract test checks
// real answers against the schemas.
import { z } from 'zod'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import { BOAT_CLASSES, type BoatClass } from '@paddlesnitch/core/types'
import type { AppRouter } from './root'

export const contractRegistry = z.registry<{ id: string }>()
const named = <T extends z.ZodType>(id: string, schema: T): T => { contractRegistry.add(schema, { id }); return schema }
// ISO 8601 timestamps; `format: date-time` lets the apps generate a real date type.
const timestamp = () => z.iso.datetime({ offset: true })

const BoatClassSchema = named('BoatClass', z.enum(BOAT_CLASSES as [BoatClass, ...BoatClass[]]))
const SeatSchema = named('Seat', z.union([z.int(), z.literal('C')]))

export const AuthUser = named('AuthUser', z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
}))
export const Me = named('Me', z.object({ user: AuthUser.nullable() }))

export const ById = named('ById', z.object({ id: z.string() }))

export const PaddleCard = named('PaddleCard', z.object({
  id: z.string(),
  paddledAt: timestamp(),
  distanceKm: z.number(),
  durationS: z.number(),
  cruiseSpeed: z.number(),
  avgSR: z.number().nullable(),
  boatClass: BoatClassSchema.optional(),
  sourceType: z.string(),
  route: z.array(z.tuple([z.number(), z.number()])),
  note: z.string().optional(),
  noGps: z.literal(true).optional(),
  sameOuting: z.array(z.object({ id: z.string(), sourceType: z.string() })).optional(),
}))
export const PaddleTotals = named('PaddleTotals', z.object({
  count: z.int(),
  totalKm: z.number(),
  totalS: z.number(),
  since: timestamp().nullable(),
}))
const Logbook = named('Logbook', z.object({
  weeks: z.array(z.object({ week: z.iso.date(), km: z.number() })),
  streakWeeks: z.int(),
  thisMonthKm: z.number(),
  lastMonthKm: z.number(),
}))
export const PaddleList = named('PaddleList', z.object({ cards: z.array(PaddleCard), totals: PaddleTotals, logbook: Logbook }))

const AnalysisPoint = named('AnalysisPoint', z.object({
  t: z.number(), lat: z.number(), lng: z.number(), speed: z.number(),
  sr: z.number().nullable(), dps: z.number().nullable(),
}))
const Segment = named('Segment', z.object({
  kind: z.enum(['rest', 'cruise', 'surge']),
  fromT: z.number(), toT: z.number(), durS: z.number(), distM: z.number(),
  avgSpeed: z.number(), splitPer500: z.number(),
  avgSR: z.number().nullable(), srCv: z.number().nullable(), avgDps: z.number().nullable(),
  trend: z.string().optional(),
}))
const SessionSet = named('SessionSet', z.object({
  count: z.int(), avgDurS: z.number(), avgSpeed: z.number(), avgSR: z.number().nullable(),
}))
const Conditions = named('Conditions', z.object({
  windKmh: z.number().optional(), windDir: z.number().optional(),
  flowM3s: z.number().optional(), flowStation: z.string().optional(),
}))
const NoPaddleReason = named('NoPaddleReason', z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no_gps'), recordedS: z.number() }),
  z.object({ kind: z.literal('gps_lost'), lostAfterS: z.number(), recordedS: z.number() }),
  z.object({ kind: z.literal('too_short'), movedM: z.number(), minM: z.number() }),
]))
export const AnalysisResult = named('AnalysisResult', z.object({
  durationS: z.number(), distanceKm: z.number(),
  avgSpeed: z.number(), avgSR: z.number().nullable(), avgDps: z.number().nullable(),
  srCv: z.number().nullable().optional(),
  cruiseSpeed: z.number(),
  strokeRateDoubled: z.boolean(),
  points: z.array(AnalysisPoint),
  stops: z.array(Segment),
  surges: z.array(Segment),
  sets: z.array(SessionSet),
  insight: z.string(),
  insightModel: z.string().optional(),
  conditions: Conditions.optional(),
  noGps: z.object({ reason: NoPaddleReason, strokes: z.int() }).optional(),
}))
const AnalysisSource = named('AnalysisSource', z.object({
  type: z.enum(['file', 'strava', 'trial', 'device']),
  filename: z.string().optional(),
  stravaActivityId: z.int().optional(),
  sport: z.string().optional(),
  trialId: z.string().optional(),
  entryId: z.string().optional(),
  courseName: z.string().optional(),
  deviceId: z.string().optional(),
  deviceSessionId: z.string().optional(),
  deviceName: z.string().optional(),
}))
export const AnalysisSession = named('AnalysisSession', z.object({
  id: z.string(),
  userId: z.string(),
  createdAt: timestamp(),
  paddledAt: timestamp(),
  source: AnalysisSource,
  doubleStrokeRate: z.boolean(),
  note: z.string(),
  insight: z.string(),
  result: AnalysisResult,
  boatClass: BoatClassSchema.optional(),
  seat: SeatSchema.optional(),
  shareId: z.string().optional(),
  insightPending: z.literal(true).optional(),
  hiddenFromBuddies: z.literal(true).optional(),
}))

// ---- Signing in (REST, not tRPC: mobile/contract/README.md, "Signing in") ----
// These routes are Next route handlers with untyped JSON answers, so there's no
// router type to check the schemas against; instead mobile-signin.test.ts reads
// the routes' real answers through them.

export const SignIn = named('SignIn', z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  // Missing on sign-up: a new account has just accepted the current Terms.
  needsTerms: z.boolean().optional(),
  idToken: z.string(),
  refreshToken: z.string(),
}))
export const OtpSession = named('OtpSession', z.object({ session: z.string() }))
export const Refreshed = named('Refreshed', z.object({ idToken: z.string() }))
export const Ok = named('Ok', z.object({ ok: z.literal(true) }))
/** A recording analysed and saved (the answer carries the whole analysis too; the apps need only which paddle). */
export const Analysed = named('Analysed', z.object({ id: z.string(), duplicate: z.literal(true).optional() }))
/** Every refusal from these routes: words to show as they are; `session` when an email code was wrong but tries remain; `reauth` when deleting needs a fresh sign-in. */
export const ApiError = named('ApiError', z.object({
  error: z.string(),
  session: z.string().optional(),
  // DELETE /api/account: no real sign-in in the last 10 minutes; sign in again, then retry.
  reauth: z.literal(true).optional(),
  // POST /att/api/auth/login (403): the password is right but the email was never confirmed; a new code has gone to it. Ask for the code, then POST signup/confirm.
  needsCode: z.literal(true).optional(),
}))

const Login = named('Login', z.object({ email: z.string(), password: z.string() }))
const OtpRequest = named('OtpRequest', z.object({
  email: z.string(),
  // The anti-bot fields: always "", and the real milliseconds since the form appeared.
  website: z.literal(''),
  elapsedMs: z.number(),
}))
const OtpVerify = named('OtpVerify', z.object({ email: z.string(), session: z.string(), code: z.string() }))
const Signup = named('Signup', z.object({ email: z.string(), displayName: z.string(), password: z.string(), acceptedTosVersion: z.string() }))
/** Sign-up has begun: a 6-digit code has gone to `email`. Nothing is signed in until signup/confirm. */
export const CodeSent = named('CodeSent', z.object({ needsCode: z.literal(true), email: z.string() }))
// acceptedTosVersion: send it when the Terms were just ticked (Create account); leave it out when the code step came from signing in, and follow needsTerms in the answer.
const SignupConfirm = named('SignupConfirm', z.object({ email: z.string(), code: z.string(), password: z.string(), acceptedTosVersion: z.string().optional() }))
const RefreshToken = named('RefreshToken', z.object({ refreshToken: z.string() }))
const WebPageFor = named('WebPageFor', z.object({ next: z.string() }))
export const WebPage = named('WebPage', z.object({ url: z.string() }))
const StravaAppToken = named('StravaAppToken', z.object({ code: z.string(), verifier: z.string() }))
// Forgot password: ask for a code by email, then set a new password with it.
const ResetRequest = named('ResetRequest', z.object({
  email: z.string(),
  // The anti-bot fields, as on OtpRequest.
  website: z.literal(''),
  elapsedMs: z.number(),
}))
const ResetConfirm = named('ResetConfirm', z.object({ email: z.string(), code: z.string(), password: z.string() }))
/** The new password is set. `signedIn` with the tokens (an app's request), or false: sign in with the new password. */
export const ResetDone = named('ResetDone', z.object({
  ok: z.literal(true),
  signedIn: z.boolean(),
  idToken: z.string().optional(),
  refreshToken: z.string().optional(),
}))

// ---- Account (C5): the website's /api/account routes, called with Authorization: Bearer ----

const TosAcceptance = named('TosAcceptance', z.object({ version: z.string(), acceptedAt: timestamp() }))
/** Whether the person has accepted the current Terms (`currentVersion`). */
export const TosStatus = named('TosStatus', z.object({
  currentVersion: z.string(),
  accepted: z.boolean(),
  acceptances: z.array(TosAcceptance),
}))
const TosAccept = named('TosAccept', z.object({ version: z.string() }))
export const TosAccepted = named('TosAccepted', z.object({ acceptances: z.array(TosAcceptance) }))
/** A short-lived link to the file; relative (to the site) only in local dev. */
export const DownloadLink = named('DownloadLink', z.object({ url: z.string() }))
/** Whether deleting can go ahead now: a real sign-in from the last 10 minutes. Ask before showing "type DELETE". */
export const AccountStatus = named('AccountStatus', z.object({ recentSignIn: z.boolean() }))
const DeleteAccount = named('DeleteAccount', z.object({
  // The app's refresh token, so it stops working at once.
  refreshToken: z.string().optional(),
}))
/** Public profile: off by default; `handle` is missing until one is claimed. */
export const ProfileSettings = named('ProfileSettings', z.object({ public: z.boolean(), handle: z.string().optional() }))
const ProfileVisibility = named('ProfileVisibility', z.object({ public: z.boolean() }))
/** Sent as the query string: `?check=<handle>`. */
const HandleCheck = named('HandleCheck', z.object({ check: z.string() }))
/** `slug` is the handle as it would be saved; `reason` says why it can't be. */
export const HandleAvailability = named('HandleAvailability', z.object({
  available: z.boolean(),
  slug: z.string().optional(),
  reason: z.string().optional(),
}))
const HandleClaim = named('HandleClaim', z.object({ handle: z.string() }))
/** The contact email, for accounts made through Strava (whose own email is a placeholder). */
export const Contact = named('Contact', z.object({
  contact: z.object({ email: z.string().optional(), addedAt: timestamp().optional() }).nullable(),
  // GET only: the sign-in email is a placeholder (an account made through
  // Strava, which never shares an email), so offer to add a contact email.
  placeholderEmail: z.boolean().optional(),
}))
const ContactEmail = named('ContactEmail', z.object({ email: z.string() }))

// Trackers: the list on Devices, every recording they uploaded, and remove.
/** One of the person's trackers. `targetVersion` is what it should run (a beta tracker may be ahead of `stableVersion`). */
export const Tracker = named('Tracker', z.object({
  deviceId: z.string(),
  name: z.string(),
  model: z.string(),
  firmware: z.string(),
  linkedAt: timestamp(),
  lastSeenAt: timestamp(),
  beta: z.literal(true).optional(),
  targetVersion: z.string().nullable(),
  // Its last start-up or hourly report; `crashTask` when that start followed a crash.
  health: z.object({
    at: timestamp(),
    kind: z.enum(['boot', 'heartbeat']),
    resetReason: z.string().optional(),
    crashTask: z.string().optional(),
  }).optional(),
  lastCrash: z.object({ at: timestamp(), task: z.string() }).optional(),
}))
export const TrackerList = named('TrackerList', z.object({ devices: z.array(Tracker), stableVersion: z.string().nullable() }))
const TrackerId = named('TrackerId', z.object({ deviceId: z.string() }))
/** A recording a tracker uploaded (it also becomes a paddle in Paddles). `motion` once its motion file is in. */
export const Recording = named('Recording', z.object({
  sessionId: z.string(),
  deviceId: z.string(),
  filename: z.string(),
  uploadedAt: timestamp(),
  startedAt: timestamp().optional(),
  endedAt: timestamp().optional(),
  distanceMetres: z.number().optional(),
  points: z.int(),
  motion: z.object({ uploadedAt: timestamp(), bytes: z.int(), rows: z.int() }).optional(),
}))
export const RecordingList = named('RecordingList', z.object({ sessions: z.array(Recording) }))

// Strava for a signed-in account: connected or not, auto-import, disconnect,
// and bringing in older paddles one at a time. Connecting itself is a browser
// page (README, "Strava, signed in").
/** `athlete` and `autoImport` only when connected. */
export const StravaStatus = named('StravaStatus', z.object({
  connected: z.boolean(),
  athlete: z.object({ id: z.int(), name: z.string() }).optional(),
  autoImport: z.boolean().optional(),
}))
const StravaAutoImportSet = named('StravaAutoImportSet', z.object({ enabled: z.boolean() }))
/** A PKCE S256 challenge, as for Strava sign-in. */
const StravaConnectStart = named('StravaConnectStart', z.object({ challenge: z.string() }))
/** The code from com.paddlesnitch.app:/account/strava?code= and the verifier behind the challenge. */
const StravaConnectFinish = named('StravaConnectFinish', z.object({ code: z.string(), verifier: z.string() }))
export const StravaAutoImport = named('StravaAutoImport', z.object({ autoImport: z.boolean() }))

/**
 * `input: null` is a multipart upload (`file`) on POST and nothing on GET or
 * DELETE; a GET's input goes in the query string. `auth: 'user'` needs
 * `Authorization: Bearer <ID token>`. See mobile/contract/README.md.
 */
type Rest = { auth: 'public' | 'user'; input: z.ZodType | null; output: z.ZodType; errors: number[] }

/**
 * The REST routes the apps call (signing in, uploads, the account), by "<METHOD> <path>". Send
 * `x-paddlesnitch-app: <platform>/<version>` on each. Every status in `errors`
 * answers with an ApiError.
 */
export const restRoutes = {
  'POST /att/api/auth/login': { auth: 'public', input: Login, output: SignIn, errors: [400, 401, 403, 500] },
  'POST /att/api/auth/otp-request': { auth: 'public', input: OtpRequest, output: OtpSession, errors: [400, 429, 500] },
  'POST /att/api/auth/otp-verify': { auth: 'public', input: OtpVerify, output: SignIn, errors: [400, 500] },
  'POST /att/api/auth/signup': { auth: 'public', input: Signup, output: CodeSent, errors: [400, 409, 422, 500] },
  'POST /att/api/auth/signup/confirm': { auth: 'public', input: SignupConfirm, output: SignIn, errors: [400, 422, 500] },
  'POST /att/api/auth/strava/app-token': { auth: 'public', input: StravaAppToken, output: SignIn, errors: [400, 401, 500] },
  'POST /att/api/auth/web-code': { auth: 'user', input: WebPageFor, output: WebPage, errors: [401] },
  'POST /paddles/api/analyse': { auth: 'user', input: null, output: Analysed, errors: [400, 401, 422, 500] },
  'POST /att/api/auth/refresh': { auth: 'public', input: RefreshToken, output: Refreshed, errors: [401] },
  'POST /att/api/auth/logout': { auth: 'public', input: RefreshToken, output: Ok, errors: [] },
  'POST /att/api/auth/password-reset/request': { auth: 'public', input: ResetRequest, output: Ok, errors: [400] },
  'POST /att/api/auth/password-reset/confirm': { auth: 'public', input: ResetConfirm, output: ResetDone, errors: [400] },
  'GET /api/account/tos': { auth: 'user', input: null, output: TosStatus, errors: [401] },
  'POST /api/account/tos': { auth: 'user', input: TosAccept, output: TosAccepted, errors: [401, 422] },
  'POST /api/account/export': { auth: 'user', input: null, output: DownloadLink, errors: [401] },
  'GET /api/account': { auth: 'user', input: null, output: AccountStatus, errors: [401] },
  'DELETE /api/account': { auth: 'user', input: DeleteAccount, output: Ok, errors: [401, 403] },
  'GET /api/account/profile': { auth: 'user', input: null, output: ProfileSettings, errors: [401] },
  'PATCH /api/account/profile': { auth: 'user', input: ProfileVisibility, output: ProfileSettings, errors: [400, 401] },
  'GET /api/account/handle': { auth: 'user', input: HandleCheck, output: HandleAvailability, errors: [401] },
  'PUT /api/account/handle': { auth: 'user', input: HandleClaim, output: ProfileSettings, errors: [400, 401] },
  'DELETE /api/account/handle': { auth: 'user', input: null, output: ProfileSettings, errors: [401] },
  'GET /api/account/contact': { auth: 'user', input: null, output: Contact, errors: [401] },
  'POST /api/account/contact': { auth: 'user', input: ContactEmail, output: Contact, errors: [400, 401] },
  'DELETE /api/account/contact': { auth: 'user', input: null, output: Ok, errors: [401] },
  'GET /api/account/devices': { auth: 'user', input: null, output: TrackerList, errors: [401] },
  'DELETE /api/account/devices': { auth: 'user', input: TrackerId, output: Ok, errors: [401, 404] },
  'GET /api/account/devices/sessions': { auth: 'user', input: null, output: RecordingList, errors: [401] },
  'GET /att/api/strava/status': { auth: 'user', input: null, output: StravaStatus, errors: [401] },
  'POST /att/api/strava/app-connect': { auth: 'user', input: StravaConnectStart, output: WebPage, errors: [400, 401, 403, 503] },
  'POST /att/api/strava/app-connect/finish': { auth: 'user', input: StravaConnectFinish, output: StravaStatus, errors: [400, 401, 403, 409] },
  'POST /att/api/strava/auto-import': { auth: 'user', input: StravaAutoImportSet, output: StravaAutoImport, errors: [400, 401] },
  'POST /att/api/strava/disconnect': { auth: 'user', input: null, output: Ok, errors: [401] },
} satisfies Record<string, Rest>

// Older Strava paddles (sources.stravaHistory → importStravaPaddle per paddle → stravaHistoryDone).
// One object with a `status` rather than a union, so the apps decode it as one type.
const HistorySpan = named('HistorySpan', z.enum(['first', 'months3', 'year', 'all']))
const StravaHistoryFor = named('StravaHistoryFor', z.object({ since: HistorySpan }))
const HistoryPaddle = named('HistoryPaddle', z.object({ id: z.int(), name: z.string(), sport: z.string(), startDate: timestamp(), distanceMetres: z.number() }))
/** `ok` with the paddles still to bring in (oldest first) and how many are in already; `rate_limited`: wait for Strava's next quarter hour. */
export const StravaHistory = named('StravaHistory', z.object({
  status: z.enum(['ok', 'not_connected', 'rate_limited']),
  toImport: z.array(HistoryPaddle).optional(),
  alreadyIn: z.int().optional(),
  // The automatic first month already happened, so don't offer it again.
  firstImportDone: z.boolean(),
}))
const StravaPaddleFor = named('StravaPaddleFor', z.object({ id: z.int(), sport: z.string(), startDate: timestamp() }))
/** `imported` or `duplicate` with the paddle's id (`sessionId`), else `skipped` and why; `rate_limited`: wait, then ask again. */
export const StravaImport = named('StravaImport', z.object({
  status: z.enum(['imported', 'duplicate', 'skipped']),
  sessionId: z.string().optional(),
  reason: z.enum(['no_tokens', 'not_water_sport', 'no_track', 'rate_limited']).optional(),
}))

type Procedure = { kind: 'query' | 'mutation'; auth: 'public' | 'user'; input: z.ZodType | null; output: z.ZodType }

/** Every procedure the apps may call, by its tRPC path. */
export const contractProcedures = {
  me: { kind: 'query', auth: 'public', input: null, output: Me },
  'paddles.list': { kind: 'query', auth: 'user', input: null, output: PaddleList },
  'paddles.get': { kind: 'query', auth: 'user', input: ById, output: AnalysisSession },
  // Writes the coach summary of a paddle that shows insightPending; the paddle page asks while it says "Writing your summary…".
  'paddles.writeSummary': { kind: 'mutation', auth: 'user', input: ById, output: AnalysisSession },
  'sources.stravaHistory': { kind: 'query', auth: 'user', input: StravaHistoryFor, output: StravaHistory },
  'sources.importStravaPaddle': { kind: 'mutation', auth: 'user', input: StravaPaddleFor, output: StravaImport },
  // Marks the history import done (sets firstImportDone).
  'sources.stravaHistoryDone': { kind: 'mutation', auth: 'user', input: null, output: Ok },
} satisfies Record<string, Procedure>

// ---- Drift checks: a schema and its procedure must accept each other's types.
type In = inferRouterInputs<AppRouter>
type Out = inferRouterOutputs<AppRouter>
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const check = <T extends true>() => undefined as unknown as T
check<Same<z.infer<typeof Me>, Out['me']>>()
check<Same<z.infer<typeof PaddleList>, Out['paddles']['list']>>()
check<Same<z.infer<typeof AnalysisSession>, Out['paddles']['get']>>()
check<Same<z.infer<typeof ById>, In['paddles']['get']>>()
check<Same<z.infer<typeof AnalysisSession>, Out['paddles']['writeSummary']>>()
check<Same<z.infer<typeof ById>, In['paddles']['writeSummary']>>()
// The Strava answers are unions in the code and one object here: every answer
// must fit the schema, and the schema may name only fields the code sends.
type Fits<A, B> = [A] extends [B] ? true : false
type KeysOf<T> = T extends unknown ? keyof T : never
check<Fits<Out['sources']['stravaHistory'], z.infer<typeof StravaHistory>>>()
check<Same<keyof z.infer<typeof StravaHistory>, KeysOf<Out['sources']['stravaHistory']>>>()
type HistoryItem = NonNullable<Extract<Out['sources']['stravaHistory'], { toImport: unknown }>['toImport']>[number]
check<Same<keyof z.infer<typeof HistoryPaddle>, keyof HistoryItem>>()
check<Fits<Out['sources']['importStravaPaddle'], z.infer<typeof StravaImport>>>()
check<Same<keyof z.infer<typeof StravaImport>, KeysOf<Out['sources']['importStravaPaddle']>>>()
check<Same<z.infer<typeof StravaHistoryFor>, In['sources']['stravaHistory']>>()
check<Same<z.infer<typeof StravaPaddleFor>, In['sources']['importStravaPaddle']>>()
check<Same<Out['sources']['stravaHistoryDone'], z.infer<typeof Ok>>>()
// And no status or reason the code never sends (Fits alone lets the schema list extra ones).
type ImportOut = Out['sources']['importStravaPaddle']
check<Same<z.infer<typeof StravaHistory>['status'], Out['sources']['stravaHistory']['status']>>()
check<Same<z.infer<typeof StravaImport>['status'], ImportOut['status']>>()
check<Same<NonNullable<z.infer<typeof StravaImport>['reason']>, Extract<ImportOut, { reason: unknown }>['reason']>>()

// ---- What `pnpm mobile:contract` writes to mobile/contract/api/ ----

/**
 * The contract as files, path → content: one JSON Schema per named type
 * (draft-07, the version Kotlin and Swift generators handle best; types refer
 * to each other by file name; unnamed fields allowed), `procedures.json`, mapping each tRPC path to
 * its kind, auth and the names of its input and output types, and `rest.json`,
 * the same for the sign-in routes plus the statuses that answer an ApiError.
 */
export function apiContractFiles(): Record<string, string> {
  const { schemas } = z.toJSONSchema(contractRegistry, {
    target: 'draft-07',
    uri: id => `${id}.schema.json`,
    // Allow fields the schema doesn't name: the server only ever adds fields,
    // and an app built against today's schema must still read tomorrow's answer.
    override: ({ jsonSchema }) => { delete jsonSchema.additionalProperties },
  })
  const files: Record<string, string> = {}
  for (const [id, schema] of Object.entries(schemas)) files[`${id}.schema.json`] = json(schema)
  const idOf = (s: z.ZodType) => contractRegistry.get(s)!.id
  files['procedures.json'] = json(Object.fromEntries(Object.entries(contractProcedures).map(([path, p]) => [path, {
    kind: p.kind, auth: p.auth, input: p.input ? idOf(p.input) : null, output: idOf(p.output),
  }])))
  files['rest.json'] = json(Object.fromEntries(Object.entries(restRoutes).map(([route, r]) => [route, {
    auth: r.auth, input: r.input ? idOf(r.input) : null, output: idOf(r.output), errors: r.errors,
  }])))
  return files
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
