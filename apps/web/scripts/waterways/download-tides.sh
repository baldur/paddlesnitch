#!/usr/bin/env bash
# Download the EA's archived readings for the tidal Thames gauges (OGL) into
# apps/web/.cache/waterways/tides/raw/, one small file per day, for
# fit-tides.ts. Each day's archive is ~60 MB for every station in England;
# only the tide gauges' rows are kept. Days already fetched are skipped, so
# the yearly refit only downloads the new ones.
#
#   bash apps/web/scripts/waterways/download-tides.sh [from YYYY-MM-DD] [to YYYY-MM-DD]
#
# The archive starts 2025-10-29. See docs/features/river-planner.md, "Tides".
set -u
FROM=${1:-2025-10-29}
TO=${2:-$(date -u -v-1d +%F 2>/dev/null || date -u -d yesterday +%F)}
OUT="$(cd "$(dirname "$0")/../.." && pwd)/.cache/waterways/tides/raw"
mkdir -p "$OUT"
fetch_day() {
  d=$1; f="$OUT/$d.csv"; [ -s "$f" ] && return 0
  curl -sf -A "paddlesnitch-river-planner tide fit (+https://paddlesnitch.com)" "https://environment.data.gov.uk/flood-monitoring/archive/readings-$d.csv" \
    | grep -E "/(0006|0007|0009)-level-tidal_level|/3401TH-level-(stage|downstage)-i-15_min-mASD" > "$f.part" && mv "$f.part" "$f" || { rm -f "$f.part"; echo "failed $d"; }
}
export -f fetch_day; export OUT
python3 -c "
import datetime, sys
d, end = datetime.date.fromisoformat('$FROM'), datetime.date.fromisoformat('$TO')
while d <= end: print(d.isoformat()); d += datetime.timedelta(days=1)" | xargs -P 3 -I{} bash -c 'fetch_day {}'
echo "$(ls "$OUT"/*.csv | wc -l | tr -d ' ') days in $OUT"
