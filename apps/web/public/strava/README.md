# Strava brand assets

These are Strava's **official** brand assets, vendored so the app follows
Strava's [brand guidelines](https://developers.strava.com/guidelines/) (#107).
They are rendered as-is via `<img>` and are never recoloured or restyled in
code (the guidelines forbid altering the marks).

| File | Official source (from Strava's brand bundle) |
|---|---|
| `connect-with-strava.svg` | `1.1 Connect with Strava Buttons / Connect with Strava Orange / btn_strava_connect_with_orange.svg` |
| `powered-by-strava.svg` | `1.2 Strava API Logos / Powered by Strava / pwrdBy_strava_orange / api_logo_pwrdBy_strava_horiz_orange.svg` |

Strava ships a single **"Connect with Strava"** button (no separate "Sign in"
button), so it's used for both first-time connect and Strava sign-in.

Where they appear:
- **"Connect with Strava"** button — the sign-in option on `/att/auth`, and the
  connect controls on `/profile/me/settings` and the upload Strava tab.
- **"Powered by Strava"** attribution — the account connection row, the upload
  activity list, and leaderboard rows imported from Strava.
- **"View on Strava"** links Strava-imported data back to its source activity
  (`https://www.strava.com/activities/{id}`).

To refresh to a newer Strava bundle, replace these two files with the same-named
official assets; no code changes needed.
