# Job: mutants (do the tests catch real bugs?)

**Goal:** stronger tests. Change one small thing in the source (a mutant),
run its tests, and see if they fail. A mutant the tests don't notice
("survives") is a bug they would miss. Write tests that kill the survivors.

**Tool:** `scripts/night-shift/mutate.mjs <source file> <test command>`. If it
doesn't exist, writing it is your first run, and it is the one exception to
"don't edit `scripts/night-shift/`". It:
1. makes mutants of the file, one at a time: `<`↔`<=`, `>`↔`>=`, `===`↔`!==`,
   `+`↔`-`, `&&`↔`||`, `true`↔`false`, a number ±1, removing a `!`, returning
   early;
2. runs the test command for each, with a timeout;
3. puts the file back exactly (check with `git diff --quiet -- <file>`);
4. prints JSON: `{ file, total, killed, survived: [{ line, from, to }] }`.
No new packages: Node and the repo's vitest only. It must leave the source as
it found it even if it crashes (restore in `finally`).

**Targets, in order** (take the first one without a score in `Lessons`):
1. `packages/timing/src/geo.ts` (race timing)
2. `apps/web/src/lib/permissions.ts` (who can see what)
3. `packages/timing/src/gpx.ts`, `csv.ts`, `tcx.ts`, `parse.ts`
4. `packages/core/src/auth.ts`

**Metric: `mutation-score`** = killed ÷ total for the target, in percent.
Higher is better.

**What to change:** test files only. Never the source. One test per survivor
or per group of related survivors, named for the behaviour it checks
(`'a crossing exactly on the line counts once'`), not for the mutant. If a
mutant can't be told apart from the original (an "equivalent" mutant), list
it in the report instead of testing it.

**Tests:** the target's own test file, then the package's full suite
(`pnpm --filter <package> test`).

## Lessons

(lead adds what it learns from your reports here, including each target's
score so the next run moves on.)
