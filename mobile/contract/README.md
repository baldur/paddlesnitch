# mobile/contract

What the Android and iPhone apps share with the server and with each other
([`docs/features/mobile-apps.md`](../../docs/features/mobile-apps.md)). It is
language-neutral: each app generates its own Kotlin or Swift from these files,
and neither app's source is ever the reference.

| Folder | What | Made by |
|---|---|---|
| `api/` | JSON Schema (draft-07) for every procedure the apps call, plus `procedures.json` | `pnpm mobile:contract`, from `packages/api/src/contract.ts` |
| `tokens/` | Colours, radii and font families | `pnpm mobile:contract`, from `packages/ui/src/tokens.css` |
| `fixtures/api/` | Golden answers per procedure, which both apps must decode | By hand, from synthetic paddles run through the real analysis; checked against the schemas by `pnpm test` |
| `fixtures/` (rest) | Recording CSV, tracker Bluetooth protocol, receipts | Phase C3 (not yet) |

**Don't edit `api/` or `tokens/` by hand.** Change the source, run
`pnpm mobile:contract`, commit the result. `pnpm test` fails while they differ.

## api/

- One `<Type>.schema.json` per named type. Types refer to each other by file
  name (`"$ref": "BoatClass.schema.json"`).
- `procedures.json` maps each tRPC path to `{ kind, auth, input, output }`:
  `kind` is `query` or `mutation`, `auth` is `public` or `user` (needs
  `Authorization: Bearer <Cognito ID token>`), and `input`/`output` name a type
  (`input: null` = takes nothing).
- Timestamps are strings with `"format": "date-time"` (ISO 8601). Whole
  numbers (counts, seat numbers, Strava ids) are `"type": "integer"`; every
  other number is a double.

### Rules both apps follow

1. **Ignore fields you don't know.** Unnamed fields are allowed everywhere; the
   server only ever adds fields.
2. **Never throw on an unknown enum value or union kind.** A newer server may
   add a source type, a boat class, a segment kind or a `NoPaddleReason`. Decode
   it into an `unknown` case and carry on. `fixtures/api/paddles.get.unknown-values.json`
   has one of each (plus an unknown field); both apps' tests must decode it.
3. **Unions of objects are discriminated by `kind`.** Every `oneOf` variant is an
   object with a `kind` string constant, so it maps to a Kotlin sealed type or a
   Swift enum with associated values. `pnpm test` enforces this. Two
   shapes are mapped by hand instead: the `[lat, lng]` tuples (arrays with
   `items: [...]`) and `Seat` (`integer` or `"C"`).

### Calling a procedure

Plain JSON over HTTPS, no batching:

```
query     GET  /api/trpc/paddles.get?input=<url-encoded JSON of the input>
mutation  POST /api/trpc/<path>   body: the input as JSON
answer    200  { "result": { "data": <output> } }
error     4xx/5xx  { "error": { "message": …, "code": …, "data": { "code": "NOT_FOUND" | "UNAUTHORIZED" | … } } }
```

A query with no input omits `?input=`.

## fixtures/api/

`<procedure>[.<case>].json`, each the `data` of one answer: `me.signed-in`,
`me.signed-out`, `paddles.list`, `paddles.get` (`pdl-river`),
`paddles.get.strava` (`pdl-strava`), `paddles.get.motion-only` (`pdl-motion`, a
paddle whose GPS failed: `result.noGps`), and `paddles.get.unknown-values`
(rule 2; deliberately does **not** fit the schema). The paddles are synthetic.

`paddles.list` is the Paddles screen as the website draws it, worked out on the
server: one card per outing (`pdl-river-watch`, the same outing from Strava,
sits under `pdl-river` in `sameOuting` and has no card of its own), the note,
`noGps` (draw the "no GPS" tag, never the route: a paddle that lost its GPS
part-way still has a route from before), the totals, and the `logbook` (12
weeks oldest first, weeks start Monday UTC). Totals and logbook count every
recording, as the website does.
Add a fixture whenever a real answer turns out to have a shape these don't.

## tokens/

`tokens.json`: `color` (hex), `radius` (px), `font` (family names; the apps
bundle IBM Plex themselves). The platform theme is dark.
