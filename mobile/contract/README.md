# mobile/contract

What the Android and iPhone apps share with the server and with each other
([`docs/features/mobile-apps.md`](../../docs/features/mobile-apps.md)). It is
language-neutral: each app generates its own Kotlin or Swift from these files,
and neither app's source is ever the reference.

| Folder | What | Made by |
|---|---|---|
| `api/` | JSON Schema (draft-07) for every procedure the apps call, plus `procedures.json` | `pnpm mobile:contract`, from `packages/api/src/contract.ts` |
| `tokens/` | Colours, radii and font families | `pnpm mobile:contract`, from `packages/ui/src/tokens.css` |
| `fixtures/` | Golden files: recording CSV, tracker Bluetooth protocol, receipts | Phase C3 (not yet) |

**Don't edit `api/` or `tokens/` by hand.** Change the source, run
`pnpm mobile:contract`, commit the result. `pnpm test` fails while they differ.

## api/

- One `<Type>.schema.json` per named type. Types refer to each other by file
  name (`"$ref": "BoatClass.schema.json"`).
- `procedures.json` maps each tRPC path to `{ kind, auth, input, output }`:
  `kind` is `query` or `mutation`, `auth` is `public` or `user` (needs
  `Authorization: Bearer <Cognito ID token>`), and `input`/`output` name a type
  (`input: null` = takes nothing).
- Unnamed fields are allowed everywhere. The server only **adds** fields, so an
  app must ignore fields it doesn't know.

### Calling a procedure

Plain JSON over HTTPS, no batching:

```
query     GET  /api/trpc/paddles.get?input=<url-encoded JSON of the input>
mutation  POST /api/trpc/<path>   body: the input as JSON
answer    200  { "result": { "data": <output> } }
error     4xx/5xx  { "error": { "message": …, "code": …, "data": { "code": "NOT_FOUND" | "UNAUTHORIZED" | … } } }
```

A query with no input omits `?input=`.

## tokens/

`tokens.json`: `color` (hex), `radius` (px), `font` (family names; the apps
bundle IBM Plex themselves). The platform theme is dark.
