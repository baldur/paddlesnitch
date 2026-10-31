#!/usr/bin/env bash
# One-off: copy the analytics events still in the server's logs (kept 90 days)
# into the analytics archive, one gzipped file per day under
# events/year=/month=/day=/backfill.json.gz, the same format the Firehose
# transform writes (infra/lambdas/analytics-archive). Run once after the
# archive is deployed, signed in with `aws sso login --profile paddlesnitch`:
#   bash infra/scripts/analytics-backfill.sh [days]   # default 90
# It stops at the moment the archive's subscription started, so nothing the
# live archive already holds is copied twice. Days already backfilled are
# skipped, so it's safe to run again.
set -euo pipefail
PROFILE=${AWS_PROFILE:-paddlesnitch}
REGION=eu-west-1
BUCKET=paddlesnitch-analytics-prod
DAYS=${1:-90}
here=$(cd "$(dirname "$0")" && pwd)
parser="$here/../lambdas/analytics-archive/index.mjs"
fn=$(aws lambda list-functions --profile "$PROFILE" --region "$REGION" \
  --query "Functions[?starts_with(FunctionName, 'AttStack-ServerFn')].FunctionName | [0]" --output text)
[ -n "$fn" ] && [ "$fn" != None ] || { echo "Couldn't find the server function"; exit 1; }
group="/aws/lambda/$fn"
cutoff=$(aws logs describe-subscription-filters --log-group-name "$group" --profile "$PROFILE" --region "$REGION" \
  --query "subscriptionFilters[?filterName=='analytics-archive'].creationTime | [0]" --output text)
[[ "$cutoff" =~ ^[0-9]+$ ]] || { echo "The archive isn't subscribed yet: deploy it first"; exit 1; }
echo "Backfilling up to $(node -e "console.log(new Date($cutoff).toISOString())"), when the live archive started"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
for ((d = DAYS; d >= 0; d--)); do
  day=$(date -u -v-"${d}"d +%Y-%m-%d 2>/dev/null || date -u -d "-${d} days" +%Y-%m-%d)
  key="events/year=${day:0:4}/month=${day:5:2}/day=${day:8:2}/backfill.json.gz"
  if aws s3api head-object --bucket "$BUCKET" --key "$key" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
    echo "$day already there"; continue
  fi
  start=$(node -e "console.log(Date.parse('${day}T00:00:00Z'))")
  end=$(( start + 86400000 - 1 )); (( end < cutoff )) || end=$(( cutoff - 1 ))
  (( start < cutoff )) || break
  aws logs filter-log-events --log-group-name "$group" --filter-pattern Event \
    --start-time "$start" --end-time "$end" \
    --profile "$PROFILE" --region "$REGION" --query 'events[].message' --output json > "$tmp/day.json"
  node --input-type=module -e "
    import { eventFromLine } from '$parser';
    import { readFileSync, writeFileSync } from 'node:fs';
    const lines = JSON.parse(readFileSync('$tmp/day.json', 'utf8')).map(eventFromLine).filter(Boolean);
    writeFileSync('$tmp/day.ndjson', lines.map((e) => JSON.stringify(e) + '\n').join(''));
    console.log('${day}', lines.length, 'events');"
  if [ -s "$tmp/day.ndjson" ]; then
    gzip -c "$tmp/day.ndjson" > "$tmp/day.json.gz"
    aws s3 cp "$tmp/day.json.gz" "s3://$BUCKET/$key" --profile "$PROFILE" --region "$REGION" --only-show-errors
  fi
done
echo "Done."
