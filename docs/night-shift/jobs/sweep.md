# Job: sweep (accessibility and console errors)

**Goal:** every page works for everyone and logs nothing alarming.

**Setup:** start the site in your clone on port **3600** (nobody else uses
it): `pnpm --filter web exec next dev -p 3600`. cognito-local on :9229 is
shared and reused. **Never run `pnpm seed`**: it wipes the users in the
shared cognito-local, which is the owner's dev data.

**Tool:** `apps/web/e2e/sweep/sweep.spec.ts` with its own config
`apps/web/e2e/sweep/playwright.config.ts` (base URL `http://localhost:3600`,
**no** `webServer`: the main config starts a server on :3000, which may be the
owner's). Run it with
`pnpm --filter web exec playwright test -c e2e/sweep/playwright.config.ts --reporter=list`.
If it doesn't exist, writing it is your first run.
Copy the axe approach from `e2e/critical/accessibility.spec.ts`. For each page,
signed out and signed in (sign up a fresh user through
`/att/api/auth/signup`), record:
- axe violations, **every** impact, rules `wcag2a`, `wcag2aa`, `best-practice`;
- `console` errors and warnings, `pageerror`s, and responses ≥ 400;

then write `$NIGHT_WORK/sweep/<date>.json`. The spec must not
fail on findings (it measures); it fails only if a page doesn't load.

Pages: everything in `accessibility.spec.ts`, plus `/analyse/library`,
`/profile/me`, `/profile/me/settings`, `/profile/me/devices`, `/games`, and a
saved paddle if the seed has one. Add pages you find linked from these.

**Metric: `sweep-problems`** = axe violations (counted by node) + console
errors + responses ≥ 400. Lower is better. Report the count per page.

**What to fix:** at most three problems per run, one commit each, in
`apps/web/` only. Pick the ones on the most pages first. For anything in
`games/` or another area, describe it under **Asks**. When a page reaches
zero serious or critical axe problems signed out, add it to `PAGES` in
`accessibility.spec.ts` so it stays that way.

Don't fix a warning by hiding it, and don't change wording (a reviewer owns
the words); describe the problem under **Asks** instead.

**Tests:** `pnpm --filter web test`, then the sweep again. Don't run the main
Playwright config (it starts a server on :3000); CI runs it on the PR.

## Lessons

(lead adds what it learns from your reports here.)

- 2026-11-16 (lead): the harness is on main (`e2e/sweep/`). The critical suite
  skips it with `testIgnore` (Playwright has no `ignoreFiles`; that line would
  have let CI run the sweep against :3000). The webpack crash on every page
  (`startAnalytics is not a function`) was a real bug: `./analytics` resolved to
  `Analytics.tsx` on a case-insensitive disk. lead is fixing it in packages/ui;
  until that is on main, report `stuck` without rebuilding the harness.
