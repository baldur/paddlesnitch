# Feature spec: Weather & river-flow conditions

**Status:** ✅ **shipped** — `@paddlesnitch/timing/conditions` (+ `weather`, `river-flow`) is live and feeds analysis and the section-compare board. Designed 2026-07-02 from issue #106.
**Owners:** Baldur (product), Claude (implementation).

## Why

A time on the water isn't comparable without context: a headwind, rain, or a
river in spate makes a big difference, and **conditions change through the day**
— 8am is not 3pm. Capturing weather + river flow *at each entry's finish time*
(plus a day-level view for the trial) adds transparency to the leaderboard and
lets paddlers read results fairly. From #106.

## Data sources (both free, no API key)

- **River flow** — the UK Environment Agency [flood-monitoring API](https://environment.data.gov.uk/flood-monitoring/)
  (open data, no key). Flow stations expose a `flow` measure in m³/s; we find
  the nearest station to the course and read the value nearest the entry time.
- **Weather** — [Open-Meteo](https://open-meteo.com/) (free, no key). Hourly
  temperature, precipitation, wind speed + direction. The **archive** API covers
  history (~5-day lag); the **forecast** API with `past_days` covers the recent
  window. We pick the hour nearest the entry's finish time.

Both are best-effort: a source being down or having no nearby station must never
break an upload or a page render.

## Settled decisions (from #106)

1. **Auto-pick location + station.** No organiser config. The course's location
   is the **midpoint of its start line** (`courseMidpoint`); the flow station is
   the nearest EA `flow` station to that point.
2. **Weather provider: Open-Meteo** (no key).
3. **Snapshot at upload time**, with a **read-time fallback** if the upload
   capture failed, and **persist whenever captured** (so a value is fetched at
   most once and then frozen onto the entry).
4. **Ship both** weather and flow.

## Domain model

```ts
// Stored on an entry's result.json and carried onto LeaderboardEntry.
type EntryConditions = {
  capturedAt: string          // ISO — when we fetched
  at: string                  // ISO — the instant the conditions describe (entry finish)
  weather?: {
    temperatureC?: number
    precipitationMm?: number
    windSpeedKmh?: number
    windDirectionDeg?: number
  }
  flow?: {
    stationId: string
    stationLabel?: string
    valueM3s?: number
    at?: string               // reading timestamp (nearest to `at`)
  }
}
```

`captured` semantics: `EntryConditions` is written once, best-effort. A **partial**
snapshot is valid (weather present, flow absent, or vice-versa) — we don't retry
a source that returned nothing on a later render, but a *fully missing*
`EntryConditions` is eligible for the read-time fallback.

## Architecture

- `src/lib/weather.ts` — `getWeatherAt(lat, lng, whenISO)` → the weather block or
  `null`. Chooses archive vs forecast Open-Meteo endpoint by how old `when` is,
  fetches the hourly series for that date, returns the hour nearest `when`.
- `src/lib/river-flow.ts` — `getFlowAt(lat, lng, whenISO)` → the flow block or
  `null`. `nearestFlowStation(lat, lng)` queries EA stations (`parameter=flow`,
  `lat/long/dist`), picks the closest with a flow measure; then reads the value
  nearest `when`.
- `src/lib/conditions.ts` — `captureConditions(lat, lng, whenISO)` runs both in
  parallel, best-effort, and returns an `EntryConditions` (or `null` if BOTH
  failed). Pure orchestration over the two clients (both injectable for tests).
- `src/lib/geo.ts` — `courseMidpoint(course)` (start-line midpoint) is the
  capture location.

All three clients parse **defensively** (the exact JSON shapes are pinned by
tests against representative fixtures; runtime is best-effort so an unexpected
shape degrades to `null`, never throws into the request).

## Capture + persistence flow

1. **At upload** (`processTrack`, after a successful result): best-effort
   `captureConditions(courseMidpoint, finishTimestamp)`; store on the entry's
   `result.json` (`conditions`). Failure is swallowed — the entry still saves.
2. **Read-time fallback** (phase 2): when a trial's entries are read and an entry
   has NO `conditions`, attempt a bounded, best-effort capture and **persist** it
   back onto `result.json` so it's frozen. Bounded so a page render never fans
   out to dozens of external calls.
3. `rebuildLeaderboard` copies `conditions` from `result.json` onto
   `LeaderboardEntry` so the table can render without re-reading each entry.

## Display

- **Per-entry** (phase 1): in the leaderboard's expanded row — temperature, wind
  (speed + arrow for direction), precipitation, and river flow (m³/s + station
  name). This is the headline value: conditions *at that paddler's finish time*.
- **Day-level summary** (phase 3): on the trial page, the flow + weather for the
  trial's date at the course location, shown once for the whole event.

## Phasing

| Phase | Scope |
|---|---|
| **1 (this PR)** | Spec; `weather.ts` + `river-flow.ts` + `conditions.ts` (tested); `EntryConditions` on entries + leaderboard; capture-at-upload; per-entry display. |
| **2** | Read-time fallback backfill (bounded, persists). |
| **3** | Day-level trial-page summary. |
| **4** | Cache the resolved `flowStationId` on the course to avoid re-querying stations per capture; organiser override of the auto-picked station. |

## Testing

Clients are unit-tested with mocked `fetch` against representative Open-Meteo /
EA fixtures: nearest-hour selection, archive-vs-forecast endpoint choice,
nearest-station selection, nearest-reading selection, and graceful `null` on
error / empty / malformed responses. `captureConditions` is tested with injected
stub clients (both succeed / one fails / both fail → partial or null).

## Notes / risks

- **API shapes** are pinned by fixtures taken from the documented responses;
  verify against a live call when wiring prod (runtime is best-effort regardless).
- **Rate/availability:** both are public; capture is best-effort and one-shot per
  entry (then frozen), so steady-state load is minimal.
- **Location proxy:** start-line midpoint is a good stand-in for "the course";
  good enough for weather and for finding a nearby flow station.
