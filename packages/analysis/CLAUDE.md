# packages/analysis — the Paddles domain

The Paddles section (pages, sources, engine, persistence, summary, sharing) is in `apps/web/CLAUDE.md` § App: Analyse. Rules that bind this package:

- **Only `saveSession` may write a paddle's `session.json`** (`paddle-summaries.test.ts` fails otherwise), or its `summary.json` goes stale.
- **Test for a paddle without a map only with `isMotionOnly()`** (`@paddlesnitch/core/paddles`), never with distance or points. It adds no km, and is never offered for compare, sections or similar paddles.
- **No AI call while anyone waits**: `analyseAndSave` saves the plain summary with `insightPending: true`; the paddle page asks for the summary (`apps/web/CLAUDE.md` § "`after()` does NOT run after the response here").
- **A stored summary carries the note and the AI text**: never hand one to a buddy or a share link. Use `othersView` (paddles router).
- Map points are downsampled and rounded at build time (`roundPoint`); see `apps/web/CLAUDE.md` § Payload sizing before changing precision.
