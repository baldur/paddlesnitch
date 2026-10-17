# Design system

🚧 Built 2026-10-17 (design sprint). Source of truth for how screens look and
behave. The audit that led here: https://claude.ai/artifact/FPBTjYjyUxwRge58Rh2MHp

**Principle:** conventional in structure and chrome, personal in the content.
Navigation, buttons, forms and lists behave the way people already expect
(Krug: *Don't make me think*; Material and Apple's HIG agree on the shapes).
The character lives in the maps, traces and numbers.

## Decisions (owner, 2026-10-17)

1. **Type:** IBM Plex Sans for reading and controls. Plex Mono only for numbers
   (times, paces, splits, distances — `.tabular`) and short data labels.
2. **Capitals:** only short mono labels over data (`<Eyebrow>`: DISTANCE, PACE
   /500, column heads). Headings, buttons, tabs, menus and links are sentence case.
3. **Corners:** one small radius (`rounded-control`, 6 px) on controls and cards;
   sheets `rounded-sheet` (12 px). Data — tables, charts, maps — stays square.
4. **Phone navigation:** a bottom tab bar with four tabs — Paddles, Trials,
   Plan, You. "You" opens the account menu as a bottom sheet. The same
   structure carries into the native apps.
5. **Signed-out front door:** lead with a real paddle view, not a row of
   equal cards.

## Feature tiers (step 2)

Where a feature sits decides how loud it is.

| Tier | Rule | Features |
|---|---|---|
| **Core** | One tap from the bottom bar / header. The screen's primary button. | Paddles list, add a paddle, one paddle · open trials, a leaderboard, submit an entry · plan a route · sign in, profile, account |
| **Supporting** | One level down, inside the screen it serves. Secondary buttons or links. | Compare two paddles, sections, race a section, buddies · courses, groups, create/manage course and trial · devices, tracker guide, Bluetooth sync · help, privacy, terms · Strava connect, download my data, delete account |
| **Delight** | Never in navigation. Found in context, next to the thing it acts on, quiet until used. | Share link + share image + "open my Strava activity" · download image · coach summary · boat motion · course record / PB marks · satellite map · plan share link · invite link through the phone's share sheet · tracker drawings in the guide |

A delight feature should reward the person who finds it, never compete with
the core task. If people can't find a supporting feature, move it, don't make
it louder.

## Components (`@paddlesnitch/ui`)

| Import | What |
|---|---|
| `Button` → `Button`, `ButtonLink`, `buttonClass(variant, size)` | `primary` (one per screen) · `secondary` · `quiet` · `danger`. 44 px tall. For a Next `<Link>` use `className={buttonClass('primary')}` |
| `Form` → `Field`, `inputClass`, `selectClass`, `Segmented` | Visible label above every input, help/error below. Inputs are 16 px text (no iPhone zoom) and 44 px tall |
| `Layout` → `Page`, `PageHeader`, `Section`, `Eyebrow`, `eyebrowClass` | Every page body is a `<Page width="narrow\|default\|wide">` starting with a `<PageHeader title …/>` |
| `Card` → `Card`, `cardClass`, `cardLinkClass`, `Chevron`, `Stat`, `Badge`, `badgeClass`, `EmptyState` | A tappable card shows a `Chevron`. Empty states invite with an action instead of explaining |
| `AppShell` (via the app's `AppHeader`) | Header + phone bottom bar |

## Rules for every screen

- **A title.** Every page has one visible `h1` (PageHeader). Breadcrumbs are
  sentence case: `← Trials`.
- **One primary action** per screen. Other actions secondary or quiet;
  destructive ones `danger`, last, with an in-page confirm.
- **Type scale:** body `text-base` (16 px); secondary `text-sm` (14 px);
  `text-xs` (12 px) only for Eyebrow labels and badges. Nothing smaller.
- **Tap targets** ≥ 44 px on phones (`min-h-11`).
- **Colour:** tokens only. Blue *text* is `text-primary-text` (readable on the
  dark ground); `bg-primary` is for filled buttons.
- **Numbers** in `.tabular` (mono). Dates through `@paddlesnitch/core/format`.
- **Phones first:** check at 390 px. Nothing runs off the right edge; tables
  that can't fit scroll inside their own container.
