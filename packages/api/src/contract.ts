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

type Procedure = { kind: 'query' | 'mutation'; auth: 'public' | 'user'; input: z.ZodType | null; output: z.ZodType }

/** Every procedure the apps may call, by its tRPC path. */
export const contractProcedures = {
  me: { kind: 'query', auth: 'public', input: null, output: Me },
  'paddles.list': { kind: 'query', auth: 'user', input: null, output: PaddleList },
  'paddles.get': { kind: 'query', auth: 'user', input: ById, output: AnalysisSession },
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

// ---- What `pnpm mobile:contract` writes to mobile/contract/api/ ----

/**
 * The contract as files, path → content: one JSON Schema per named type
 * (draft-07, the version Kotlin and Swift generators handle best; types refer
 * to each other by file name; unnamed fields allowed) and `procedures.json`, mapping each tRPC path to
 * its kind, auth and the names of its input and output types.
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
  return files
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
