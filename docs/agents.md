# Agent roles

How Claude sessions are organised in this repo: who does what, how to start
each one, and the rules that keep them from stepping on each other. The `help`
agent answers questions about this setup from this page, so keep it current.

**The short version:** talk to `lead`. It routes work to the right specialist,
runs the reviewers on every PR, and tells you which agents it used. Open a
platform's own window only when that platform has a lot of work going on.

## The roles

| Role | Kind | Runs as | Owns (only it edits these) | Worktree |
|---|---|---|---|---|
| `lead` | coordinator | window | `mobile/contract/`, `docs/agents.md`, `.claude/agents/`, and every change that crosses areas | `../paddlesnitch-lead` |
| `help` | guide | window, or ask any session | nothing (read-only) | `../paddlesnitch-help` (kept on `main`) |
| `android` | builder | window | `mobile/android/` | `../paddlesnitch-android` |
| `ios` | builder | window | `mobile/ios/` | `../paddlesnitch-ios` |
| `firmware` | builder | helper, or a window when busy | `firmware/` | `../paddlesnitch-firmware` |
| `motion-core` | builder | helper, or a window when busy | `recorder-core/`, `packages/timing/src/{cadence,attitude,device}.ts` | `../paddlesnitch-motion-core` |
| `game` | builder | helper, or a window when busy | `games/` | `../paddlesnitch-game` |
| `tester` | reviewer | helper | nothing (reports) | none |
| `security-privacy` | reviewer | helper | nothing (reports) | none |
| `design-usability` | reviewer | helper | nothing (reports) | none |
| `copy-style` | reviewer | helper | nothing (reports) | none |

Everything else (the web app, packages, infra) belongs to `lead`, which can
hand a piece to a helper.

- **Builders** do long-running work in one area. A window keeps its context for
  days; a helper is spawned for one job and forgets it afterwards.
- **Reviewers** check a change with fresh eyes and report findings. They never
  edit. `lead` (or a builder) calls them; you don't need to.
- **Helper** means another session spawns it with the Agent tool
  (`subagent_type: "tester"`). **Window** means you start it yourself (below).

## Starting a window

```sh
psa lead          # or android, ios, firmware, motion-core, game, help
psa -h            # usage and the list of roles
```

`psa` is a shell function (add it to `~/.zshrc` once):

```sh
psa() { git -C ~/Documents/Code/paddlesnitch.com fetch -q origin && bash <(git -C ~/Documents/Code/paddlesnitch.com show origin/main:scripts/agents/start.sh) "$@"; }
```

It runs `scripts/agents/start.sh` from the latest `main`, which:

1. fetches `origin`,
2. creates the role's worktree from `origin/main` if it doesn't exist yet (branch `role/<name>`),
3. warns if that worktree's agent briefs are behind `main`,
4. starts `claude --agent <role> -n <role>` in it.

`--agent` gives the session its brief; `-n` names it, so `/resume` shows the
role and other sessions can message it by that name. Reviewers can run as
windows too (`psa tester`), but they're more useful as helpers.

### In herdr

The owner runs everything in one herdr workspace, a tab per role.

- `psa --tab <role>` opens the role in a new tab labelled with the role, in its
  worktree, or switches to it if it's already running. You can also just ask
  `lead` ("start android"), and it runs this for you.
- `psa <role>` typed in an existing tab also labels the tab and names the
  agent after the role.
- Either way, herdr knows each agent by its role, so any session can check on
  the others and message them:

  ```sh
  herdr agent list                                # who's running, idle/working/blocked
  herdr agent prompt android "…" --wait           # send android a message
  herdr agent read android                        # see what it last printed
  ```

  `lead` and `help` use these. A `blocked` agent is waiting for an approval or
  a question for the owner: only the owner answers those.

## Rules every role follows

1. **Fresh branch per task.** `git fetch origin && git switch -c <branch> origin/main`
   in your own worktree. Never edit, check out or stash in the main folder
   (`~/Documents/Code/paddlesnitch.com`): the owner works there.
2. **Stay in your area.** Need a change in someone else's area? Message the
   owner of that area if their window is running (`herdr agent list` shows who
   is, or `ListAgents` outside herdr), or ask `lead`. Don't patch it yourself.
3. **One PR for a change that crosses areas,** done end to end by `lead`, so
   nothing is lost in a handoff.
4. **Reviewers before a PR** (see `lead`'s routing rules). Say which agents you used.
5. **Write lessons down.** A non-obvious lesson goes into your area's
   `CLAUDE.md` (or `.claude/agents/<role>.md` for how the role works) before
   you finish. That's how a role gets better over time: sessions don't remember,
   files do.
6. **The owner merges.** Say which PRs depend on which and the order to merge.
   Firmware PRs always wait for the owner (a merge releases to trackers).
7. **CI is the referee.** The shared fixtures (`mobile/contract/fixtures/`, and
   `recorder-core/fixtures/`) must pass on every platform. A
   red build beats an agent remembering a rule.

## Where each role's knowledge lives

| Role | Read first |
|---|---|
| all | `CLAUDE.md` (root), this page; a nested `CLAUDE.md` loads by itself when you work in its folder (index in the root file) |
| `lead` | `apps/web/CLAUDE.md`, `infra/CLAUDE.md`, `.github/CLAUDE.md`, `packages/*/CLAUDE.md` |
| `android` | `mobile/android/README.md`, `mobile/android/CLAUDE.md`, `docs/features/android-app.md`, `docs/features/mobile-apps.md` |
| `ios` | `mobile/ios/README.md`, `mobile/ios/CLAUDE.md`, `docs/features/ios-app.md`, `docs/features/mobile-apps.md` |
| `firmware` | `firmware/CLAUDE.md`, `docs/features/release-testing.md`, `docs/features/device-uplink.md` |
| `motion-core` | `packages/timing/CLAUDE.md`, `docs/features/on-device-metrics.md`, `docs/features/one-paddle.md`, `docs/features/motion-only-paddles.md` |
| `game` | `games/CLAUDE.md` |
| `design-usability` | `docs/features/design-system.md` |
| `security-privacy` | `apps/web/CLAUDE.md`, `infra/CLAUDE.md`, `docs/features/devices-platform.md` |
| `copy-style` | `CLAUDE.md` § Writing for the site |

## Local servers and ports

Each window gets its own port so two `next dev`s don't collide:
`lead` 3200, `android` 3300, `ios` 3400 (`pnpm --filter web exec next dev -p <port>`).
The games serve on 8000/8001 (`pnpm games`, `pnpm games:site`).

`pnpm dev` starts cognito-local on :9229 and **reuses** one that's already
running, even if another worktree started it. If sign-in behaves oddly, check
which folder owns it: `lsof -iTCP:9229 -sTCP:LISTEN`, then `lsof -p <pid> | grep cwd`.

## Changing this setup

Edit `.claude/agents/<role>.md` (the brief; its `description` line is what
decides when `lead` calls it) and this page, in one PR from `lead`.
`pnpm test:agents` checks that every role in `.claude/agents/` is listed here
and has a name and description.
