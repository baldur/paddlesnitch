# ATTS — the original requirements (historical)

> **This is a historical record, not current behaviour.** It is the brief for
> **ATTS**, the single-purpose time-trial app that became the `/att` section of
> paddlesnitch. Kept because it is the origin story and shows what the product
> was before it grew a session-analysis section and a hardware tracker.
>
> It called itself a living document and then stopped living, so several claims
> are now **the opposite of the truth**:
>
> | It says | Actually |
> |---|---|
> | "Anyone can create a trial on any course" ✅ | Gated to a group's owner/admins |
> | "No private courses or hidden results" | Visibility is public / private / group |
> | Magic link auth ✅ built | Returns `501`; verify redirects `magic_disabled` |
> | AWS production infrastructure 🔲 not built | Live on CloudFront + Lambda + CDK |
> | UI redesign "light, minimal, dense" ✅ | The platform is **dark** |
>
> **[`CLAUDE.md`](../CLAUDE.md) is the source of truth for current behaviour.**

---

## What it is

A web app for GPS-timed route competitions — like Strava segments, but user-created and explicitly competitive. Anyone can define a course on a map, open a time trial on it, and others submit GPS tracks to see who covered it fastest. Used by individuals wanting personal times and by clubs/coaches running regular competitions with minimal supervision.

---

## Users & Access

### Authentication
- **Password** — email + password signup/login ✅ built (local dev only)
- **Magic link** — user enters email or phone, receives a one-time link/code; no password needed 🔲
- **OAuth** — Google (and others) later 🔲

### Visibility
- **Public by default** — leaderboards, course maps, results, splits are all readable without logging in
- **Actions require login** — creating a course, creating a trial, uploading a trace
- No private courses or hidden results for now; access controls may be added later

### Anyone can
- View any course, trial, leaderboard, or result without an account
- Create a course (when logged in)
- Create a time trial on **any** course (when logged in) — not restricted to the course owner
- Upload a GPS trace to any open trial (when logged in)

### Course/trial owner can
- Edit their own course
- Open / close their own trial

---

## Courses

### One-way course
- Admin draws a **start line** across the waterway (2 points)
- Admin draws a **finish line** across the waterway (2 points)
- Distance auto-calculated (Haversine between line midpoints) ✅

### Loop course 🔲
- Admin draws **one line** across the waterway
- Paddler crosses it once (start), paddles to a physical turning point (e.g. a buoy), returns and crosses the same line again (finish)
- Direction matters — first crossing going one way = start; next crossing going the other way = finish
- The turning point is physical/visual only; not defined in the system

### Course fields
- Name
- Sport: `kayak` | `rowing` | `both`
- Type: `one_way` | `loop` 🔲
- Start line (2 points) — or single line for loop
- Finish line (2 points, one-way only)
- Distance (auto-calculated) ✅
- Created by (user)

---

## Time Trials

- Any logged-in user can create a trial on any course
- Has a name and date
- Status: `open` | `closed` (manually controlled by trial creator)
- When open, any logged-in user can submit a trace
- A user can submit multiple times — all entries appear on the leaderboard, sorted by time

---

## GPS Submission

### File upload
- GPX ✅
- FIT ✅
- CSV ✅
- Unknown formats: return a clear error message ✅

### Activity URL 🔲
- User pastes a public activity link from Strava, Garmin Connect, or similar
- System fetches the GPS data server-side from the public URL
- Supported at launch: Strava public activities
- Garmin Connect public activities: best-effort (scrape if possible, otherwise inform user to export manually)
- Apple: no public URL sharing — file export only

### Processing ✅
- Detect start/finish line crossings
- Calculate elapsed time, 500 m splits
- Extract HR and cadence series if present
- For loops: detect two crossings of the same line in opposite directions 🔲

---

## Leaderboard

- Ranked by fastest time, ascending ✅
- Shows display name, time, date submitted ✅
- Expandable 500 m splits ✅
- HR / cadence averages if available ✅
- All entries shown, sorted by time — multiple entries per user allowed and visible
- Publicly readable without login 🔲 (currently auth-gated)

---

## UI

- **Style**: light background, minimal, data-centric — dense tables, no decoration
- **Font**: keep IBM Plex Mono (suits timing/data context)
- **Colour**: predominantly white/light grey surfaces, black text, one accent colour for key actions and times
- **Maps**: keep dark CartoDB tiles and cyan river overlay (maps are an exception to the light theme — dark maps read better)
- No rounded corners on data elements
- Mobile-first, tap targets ≥ 44 px
- 🔲 Full UI redesign required — current retro amber theme to be replaced

---

## Implementation Status

| Area | Status |
|---|---|
| Course creation (one-way) | ✅ Built |
| Course creation (loop) | ✅ Built |
| Time trial create / open / close | ✅ Built |
| GPX / FIT / CSV upload + processing | ✅ Built |
| Line crossing detection + splits | ✅ Built |
| Loop crossing detection (opposite-direction) | ✅ Built |
| Leaderboard | ✅ Built |
| Multiple entries per user, all shown | ✅ Built |
| Public (no-auth) leaderboard viewing | ✅ Built |
| Anyone can create trial on any course | ✅ Built |
| Activity URL submission (Strava / direct .gpx) | ✅ Built |
| Password auth (local dev) | ✅ Built |
| Magic link auth (email, 15 min token) | ✅ Built |
| OAuth (Google) | 🔲 Not built |
| UI redesign (light, minimal, dense) | ✅ Built |
| AWS production infrastructure | 🔲 Not built |
