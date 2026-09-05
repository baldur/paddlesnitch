# Sample sessions

Kept deliberately — these are test fixtures and the historical record, not scratch.

| File | What it is |
|---|---|
| `track_0005.csv` | First successful outdoor fix (2026-09-05). **Pre-0.3.0 format**, no `timestamp` column, so paddlesnitch's `parseCsv` correctly reads 0 points from it. Useful as the negative fixture. |
| `track_0005_converted.csv` | The same run rewritten in the current format. Parses to **421 points**. This is the fixture for "the device CSV parses with no device-specific parser". |
| `track_0039.csv` | First session recorded with fix-gated recording (0.5.0). 90 rows, **100% with a fix**, uploaded `HTTP 201`. The realistic current-format fixture. |
| `run.json` | `track_0005.csv` reduced for the published analysis page. Regenerate rather than hand-edit. |

Bench sessions with no GPS fix were deleted; they are trivially reproducible by
powering the device up indoors.
