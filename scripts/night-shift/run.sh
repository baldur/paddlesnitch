#!/usr/bin/env bash
# Night shift runner (docs/night-shift/README.md). Loops: pick a job, give the
# local model one run of it, keep what it made.
#
# The boundary is sandbox.sb (deny by default), not the model's permission
# rules. Two folders:
#   ~/.paddlesnitch/night-shift   the model's: it can write here (scratch, its report)
#   ~/.paddlesnitch/night-runner  this script's: the model can read, never write
#     (log, copies of reports, bundles of its branches, steer.md, config).
# Each run starts from a fresh clone of main with no remote, set up here
# before the model starts, so nothing the model planted last time survives.
#
# Run it from main, so the copy that runs is one the model can't have edited:
#   bash <(git -C ~/Documents/Code/paddlesnitch.com show origin/main:scripts/night-shift/run.sh)
# Options: --once, --job <name>,
#   --shell <bundle> <cmd…>   check out a bundle's branch in a fresh clone and
#                             run a command in the sandbox (how lead re-measures).
# Stop: touch ~/.paddlesnitch/night-runner/pause
set -uo pipefail

MAIN=~/Documents/Code/paddlesnitch.com
CLONE=~/Documents/Code/paddlesnitch-night
NIGHT=~/.paddlesnitch/night-shift
RUNNER=~/.paddlesnitch/night-runner
JOBS=(views footage mutants sweep)
MODEL=ollama/qwen3.8-64k:latest  # for the busy check; the agent file names the model
GATE_PORT=11435
SERVE_PORT=4097
RUN_MINUTES=${NIGHT_RUN_MINUTES:-120}
ONCE=0; FORCE_JOB=; SHELL_BUNDLE=; SHELL_CMD=()
while [ $# -gt 0 ]; do
  case $1 in
    --once) ONCE=1 ;;
    --job) FORCE_JOB=$2; shift ;;
    --shell) SHELL_BUNDLE=$2; shift 2; SHELL_CMD=("$@"); break ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done

mkdir -p "$NIGHT" "$RUNNER"/{inbox,done,bundles,out,xdg-config/opencode}
touch "$RUNNER/log.jsonl"
say() { echo "[night $(date +%H:%M)] $*"; }

# From main every time: what runs here is never a copy the model could edit.
from_main() { git -C "$MAIN" show "origin/main:$1"; }

write_config() {
  cat >"$RUNNER/xdg-config/opencode/opencode.json" <<EOF
{ "autoupdate": false, "share": "disabled",
  "provider": { "ollama": { "npm": "@ai-sdk/openai-compatible", "name": "Ollama (night gate)",
    "options": { "baseURL": "http://127.0.0.1:$GATE_PORT/v1" },
    "models": { "qwen3.8-64k:latest": { "name": "qwen3.8-64k" } } } } }
EOF
}

# Run a command in the sandbox, in the clone, in a clean environment.
sb() {
  (cd "$CLONE" && exec env -i HOME="$HOME" PATH="$PATH" USER="$USER" TERM=dumb LANG="${LANG:-en_GB.UTF-8}" \
    TMPDIR="$NIGHT/tmp" NEXT_TELEMETRY_DISABLED=1 OPENCODE_PASSWORD="${OPENCODE_PASSWORD:-}" \
    XDG_CONFIG_HOME="$RUNNER/xdg-config" XDG_DATA_HOME="$NIGHT/xdg/data" \
    XDG_STATE_HOME="$NIGHT/xdg/state" XDG_CACHE_HOME="$NIGHT/xdg/cache" \
    sandbox-exec -p "$PROFILE" -D HOME="$HOME" -D CLONE="$CLONE" -D NIGHT="$NIGHT" -D GATE_PORT="$GATE_PORT" "$@")
}

# A fresh clone of main (or of a bundle's branch), installed, before the model
# touches it. Packages are copied, never hard-linked to the shared pnpm store.
fresh_clone() {  # <branch name> [bundle]
  git -C "$MAIN" fetch -q origin || return 1
  PROFILE=$(from_main scripts/night-shift/sandbox.sb) || return 1
  rm -rf "$CLONE" "$NIGHT"
  mkdir -p "$NIGHT"/{tmp,xdg}
  restore_outputs
  git clone -q --no-checkout --no-hardlinks "$MAIN" "$CLONE" || return 1
  git -C "$CLONE" remote remove origin
  git -C "$CLONE" fetch -q "$MAIN" "+refs/remotes/origin/main:refs/heads/base" || return 1
  if [ -n "${2:-}" ]; then
    git -C "$CLONE" fetch -q "$2" "+refs/heads/$1:refs/heads/$1" || return 1
    git -C "$CLONE" switch -q "$1" || return 1
  else
    git -C "$CLONE" switch -q -c "$1" base || return 1
  fi
  (cd "$CLONE" && pnpm install --frozen-lockfile --prefer-offline --package-import-method=clone-or-copy >/dev/null 2>&1) || { say "pnpm install failed"; return 1; }
}

start_gate() {
  from_main scripts/night-shift/ollama-gate.mjs >"$RUNNER/ollama-gate.mjs"
  node "$RUNNER/ollama-gate.mjs" "$GATE_PORT" >>"$RUNNER/gate.log" 2>&1 &
  GATE_PID=$!
}

# What a job keeps between runs (views/model-scores.json, footage proposals,
# sweep results) is saved here after each run and put back before the next.
# Regular files only: links are skipped, so nothing points out of the folder.
OUTPUTS=(views footage sweep)
save_outputs() {
  python3 -I - "$NIGHT" "$RUNNER/out" "${OUTPUTS[@]}" <<'PY'
import os, shutil, sys
src, dst, names = sys.argv[1], sys.argv[2], sys.argv[3:]
for n in names:
    s, d = os.path.join(src, n), os.path.join(dst, n)
    if os.path.islink(s) or not os.path.isdir(s): continue
    shutil.rmtree(d, ignore_errors=True)
    for root, dirs, files in os.walk(s):
        dirs[:] = [x for x in dirs if not os.path.islink(os.path.join(root, x))]
        for f in files:
            p = os.path.join(root, f)
            if os.path.islink(p) or not os.path.isfile(p) or os.path.getsize(p) > 50_000_000: continue
            out = os.path.join(d, os.path.relpath(p, s)); os.makedirs(os.path.dirname(out), exist_ok=True)
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as a, open(out, "wb") as b: shutil.copyfileobj(a, b)
PY
}
restore_outputs() {
  local n; for n in "${OUTPUTS[@]}"; do
    if [ -d "$RUNNER/out/$n" ]; then cp -R "$RUNNER/out/$n" "$NIGHT/$n"; else mkdir -p "$NIGHT/$n"; fi
  done
}

pick_job() {
  [ -n "$FORCE_JOB" ] && { echo "$FORCE_JOB"; return; }
  local only
  only=$(grep -m1 -E '^only: *[a-z]+' "$RUNNER/steer.md" 2>/dev/null | sed -E 's/^only: *//')
  [ -n "$only" ] && { echo "$only"; return; }
  python3 -I - "$RUNNER/log.jsonl" "${JOBS[@]}" <<'PY'
import json, sys
last = {}
for line in open(sys.argv[1]):
    try: r = json.loads(line); last[r["job"]] = r["at"]
    except Exception: pass
print(min(sys.argv[2:], key=lambda j: last.get(j, "")))
PY
}

model_busy() {  # another model loaded (e.g. the overnight colour run)
  ollama ps 2>/dev/null | tail -n +2 | grep -v '^$' | grep -vq "${MODEL#ollama/}"
}

# Copy the model's report out of its folder (never following a link, capped),
# and log its front matter.
collect() {  # <report in NIGHT> <copy in RUNNER> <job> <branch or none>
  python3 -I - "$@" "$RUNNER/log.jsonl" <<'PY'
import json, os, sys, datetime
src, dst, job, branch, log = sys.argv[1:6]
fm, text = {"result": "no-report"}, ""
try:
    fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
    if os.path.isfile(f"/dev/fd/{fd}"):
        text = os.read(fd, 200_000).decode("utf-8", "replace")
    os.close(fd)
except OSError:
    pass
if text:
    open(dst, "w").write(text)
    if text.startswith("---"):
        for line in text.split("---")[1].splitlines()[:12]:
            if ":" in line:
                k, v = line.split(":", 1); fm[k.strip()[:20]] = v.strip()[:200]
fm.update(job=job, branch=branch, report=dst if text else None,
          at=datetime.datetime.now().isoformat(timespec="seconds"))
open(log, "a").write(json.dumps(fm) + "\n")
print(fm["result"], fm.get("metric", ""), fm.get("before", ""), "->", fm.get("after", ""))
PY
}

cleanup() {
  [ -n "${SERVE_PID:-}" ] && kill -TERM -- "-$SERVE_PID" 2>/dev/null
  [ -n "${RUN_PID:-}" ] && kill -TERM -- "-$RUN_PID" 2>/dev/null
  [ -n "${GATE_PID:-}" ] && kill "$GATE_PID" 2>/dev/null
  pkill -f "$CLONE" 2>/dev/null; pkill -f "$NIGHT" 2>/dev/null
  # Its servers by the ports they hold ($! above is a subshell, not the server).
  lsof -ti "tcp:$SERVE_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  lsof -ti tcp:3600 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  SERVE_PID= RUN_PID= GATE_PID=
}
trap 'cleanup; exit 130' INT TERM

run_once() {
  local job stamp branch report
  job=$(pick_job)
  case " ${JOBS[*]} " in *" $job "*) ;; *) say "unknown job '$job'"; return 1 ;; esac
  stamp=$(date +%Y%m%d-%H%M)
  branch="night/$job-$stamp"
  report="$NIGHT/report.md"

  fresh_clone "$branch" || { say "setup failed"; return 1; }
  write_config
  # The footage job reads a copy of the footage index (read-only to it).
  [ "$job" = footage ] && sqlite3 ~/.paddlesnitch/footage/footage.db ".backup '$RUNNER/footage.db'"
  start_gate
  export OPENCODE_PASSWORD; OPENCODE_PASSWORD=$(openssl rand -hex 16)

  say "job $job on $branch"
  # opencode's server runs in the sandbox too: it's what runs the tools.
  sb perl -e 'setpgrp(0,0); exec @ARGV' opencode serve --hostname 127.0.0.1 --port "$SERVE_PORT" >>"$RUNNER/inbox/$stamp-$job.log" 2>&1 &
  SERVE_PID=$!
  perl -e 'select(undef,undef,undef,5)'
  local prompt="You are the night shift. Job: $job. Branch: $branch (already checked out). Write your report to $report. Read docs/night-shift/README.md, then docs/night-shift/jobs/$job.md, and do exactly one run. Write the report before you stop."
  sb perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' $((RUN_MINUTES * 60)) \
    opencode run --server "http://127.0.0.1:$SERVE_PORT" --agent night-shift --auto --title "night $job $stamp" "$prompt" \
    >>"$RUNNER/inbox/$stamp-$job.log" 2>&1 &
  RUN_PID=$!
  wait "$RUN_PID"; say "opencode exited ($?)"
  cleanup

  # Keep its branch as a bundle in the runner's folder (made in the sandbox:
  # the clone's git config is the model's).
  if [ -n "$(sb git rev-list base..HEAD 2>/dev/null)" ]; then
    sb git bundle create -q "$NIGHT/branch.bundle" "base..$branch" \
      && python3 -I -c 'import os,shutil,sys; fd=os.open(sys.argv[1], os.O_RDONLY|os.O_NOFOLLOW); shutil.copyfileobj(os.fdopen(fd,"rb"), open(sys.argv[2],"wb"))' \
         "$NIGHT/branch.bundle" "$RUNNER/bundles/$stamp-$job.bundle" \
      || branch=none
  else
    branch=none
  fi
  save_outputs
  say "$(collect "$report" "$RUNNER/inbox/$stamp-$job.md" "$job" "$branch")"
}

if [ -n "$SHELL_BUNDLE" ]; then
  name=$(git bundle list-heads "$SHELL_BUNDLE" | awk '{print $2}' | sed 's#^refs/heads/##' | head -1)
  fresh_clone "$name" "$SHELL_BUNDLE" || exit 1
  write_config; start_gate
  sb "${SHELL_CMD[@]}"; rc=$?
  cleanup; exit $rc
fi

while true; do
  if [ -e "$RUNNER/pause" ]; then say "paused (rm $RUNNER/pause to resume)"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  if ! curl -sf http://localhost:11434/api/tags >/dev/null; then say "Ollama isn't running"; [ $ONCE = 1 ] && exit 1; sleep 600; continue; fi
  if model_busy; then say "another model is busy; waiting"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  run_once
  [ $ONCE = 1 ] && exit 0
  sleep 300
done
