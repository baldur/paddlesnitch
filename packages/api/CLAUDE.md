# packages/api — the tRPC router

How the API is mounted and called is in the root `CLAUDE.md` (Platform & monorepo). Rules that bind this package:

- **Mobile contract:** schemas are in `src/contract.ts`, type-checked against the router. After a change run `pnpm mobile:contract`; `mobile-contract.test.ts` fails while `mobile/contract/` is stale. Tell `android` and `ios` what changed (`docs/agents.md`).
- **Anyone but the owner gets `othersView`** (paddles router), never a stored paddle summary: it carries the note and the AI text. `buddies.paddles` and `buddies.paddle` go through `canViewPaddle` (`packages/core/CLAUDE.md` § Buddies) and answer NOT_FOUND for every "no".
- **Telemetry:** the outermost middleware (`src/trpc.ts`) logs one `api_call` line per HTTP call; only server codes count as errors (`apps/web/CLAUDE.md` § Operational telemetry).
- **Public `/api/v1` is a stable contract** (add fields, never rename or remove); see `apps/web/CLAUDE.md` § Public API and MCP.
