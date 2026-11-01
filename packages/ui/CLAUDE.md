# packages/ui — the shared UI shell

Moved from the root `CLAUDE.md`. Design tokens and rules: root `CLAUDE.md` § Design System and `docs/features/design-system.md`.

## `@paddlesnitch/ui` (`packages/ui/src`)

The shared UI shell ([`single-app-shell.md`](../../docs/features/single-app-shell.md)). Theme-aware,
**presentational + config-driven** (props: user, hrefs, callbacks, endpoint), per-file
subpath exports, `transpilePackages`d. The app wires it once: `components/AppHeader.tsx`
(every page's header) + `components/AccountMenu.tsx` (the account menu).
- `tokens.css` — canonical platform design tokens (**dark**) as a Tailwind v4
  `@theme`. An app's `globals.css` does `@import "@paddlesnitch/ui/tokens.css"` +
  `@source "…/packages/ui/src"`; components use only the semantic token classes
  (`bg-bg`, `text-fg`, `border-border`, `text-muted`, `text-primary`, …).
- `FeedbackWidget` — the one report-an-issue widget (floating + opens on a
  `paddlesnitch:open-feedback` event), POSTs to `/att/api/feedback`. The
  floating button shows **from `sm` up only** — on phones it covered form fields
  and content. Phones open it from the footer's `ReportIssueButton` (a named
  export of the same file; also used on the error page) or the account menu.
- `AccountNav` — signed-in/out account nav (props-driven). **Signed in it's a single dropdown** (`Name ▾`) holding everything common to every page — Paddles, Buddies, Devices, Profile, Account, Report an issue (dispatches `paddlesnitch:open-feedback`), Sign out; closes on click-outside + Escape. `variant="tab"` renders the same items as the phone bottom bar's **You** tab, opening a bottom sheet. `paddlesHref`/`devicesHref`/`buddiesHref` are optional (omit → row disappears). Signed out → a plain `Sign in` link (or tab). The app's `AccountMenu` mounts it twice (header + tab); the two share one `/auth/me` and one buddy-count request.
- `AppShell` — platform header (brand + Paddles/Trials/Plan/Games section **tabs**, underlined when lit, + optional section `nav` slot + account slot) and, **below `sm`, a fixed bottom tab bar** (Paddles, Trials, Plan, Games, You — five across; the `you` slot; z-1050: above Leaflet controls at 1000, below the feedback dialog and sheets). The root layout pads `<body>` for the bar on phones. The breadcrumb always has its own row under the header row (squeezed beside the tabs on phones it was cut to "←…"). The lit tab comes from the URL via `sectionFor(pathname)` (`/att…` → trials, `/paddles…` → paddles, `/plan…` → plan, `/games…` → games, anything else → neither); the app's `AppHeader` reads `usePathname()`. It used to hard-code `att`, lighting TRIALS on home/profile/account pages. Page titles use the root template `%s · paddlesnitch`; each section's `layout.tsx` names itself (Trials, Paddles, Profile). Inside Trials, back links say **← Trials** (to `/att`); **← Home** always means `/`. Common actions live in `AccountNav`'s dropdown, **not** the top level (there is no standalone REPORT button anymore — anonymous users get `FeedbackWidget`'s floating button on desktop and the footer's Report an issue everywhere). **Cross-app links (`/`, `/att`, `/analyse`) and the account links (`/att/…`, `/profile/…`) use plain `<a>`, NOT `next/link`** — Analyse runs under `basePath:'/analyse'`, which makes `<Link>` prepend the basePath (turning `/att` into `/analyse/att`). App-supplied same-app `nav` children keep using `<Link>` (they SHOULD get the basePath).
- `Analytics` + `analytics` + `metrics-events` — shared client event capture (see Product analytics under Ops). `metrics-events` is the pure event allowlist (single source of truth); `analytics` is the buffered `capture()`/`flush()`/`startAnalytics()` pump; `Analytics` is the layout-mounted component both apps render. att re-export shims live at `@/lib/analytics` + `@/components/Analytics`; att's `@/lib/metrics` re-exports the vocabulary and keeps the server EMF helpers.

---
