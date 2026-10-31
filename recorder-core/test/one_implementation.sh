#!/usr/bin/env bash
# One implementation (docs/features/on-device-metrics.md): what turns sensor
# samples into lines and numbers lives in recorder-core/, and nowhere else.
# This can't recognise motion maths in general; it pins the copies an app is
# most likely to grow:
#   - the apps call the core only through the phone layer (rc_phone_*):
#     calling rc_imu/rc_second directly skips putting late, batched events
#     in order, and rows stop matching a replay;
#   - the apps don't convert sensor units (the phone layer does): a second
#     conversion either doubles it or drifts from the core's.
# Phases 2-3 add: the TypeScript stroke rate and boat motion are gone.
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
fail=0

direct=$(git grep -n -I --untracked -E '(^|[^A-Za-z0-9_])rc_(imu|second|init)[[:space:]]*\(' -- mobile || true)
if [ -n "$direct" ]; then
    echo "FAIL: the apps call the core directly; go through recorder_phone.h (rc_phone_*):"
    echo "$direct"
    fail=1
fi

units=$(git grep -n -I --untracked -E '9\.8066|57\.295|180(\.0)?[[:space:]]*/[[:space:]]*(Math\.|kotlin\.math\.|Double\.|\.)?(PI|pi)([^A-Za-z0-9_]|$)' -- mobile || true)
if [ -n "$units" ]; then
    echo "FAIL: sensor unit conversion in an app; recorder_phone.h does it (pass the platform's own values):"
    echo "$units"
    fail=1
fi

[ "$fail" -eq 0 ] && echo "ok   one implementation: the apps reach the core only through recorder_phone.h"
exit "$fail"
