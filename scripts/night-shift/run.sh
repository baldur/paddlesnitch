#!/usr/bin/env bash
# Night shift runner (docs/night-shift/README.md). Loops: when the Mac is on
# power, Ollama is up and no other model is loaded, give the local model one run of a job, keep what
# it made, rest five minutes, repeat.
#
# The boundary is sandbox.sb (deny by default), not the model's permission
# rules. Every run gets a new, random folder (~/.paddlesnitch/night-runs/<id>)
# holding a fresh clone of main (no remote) and a work folder: the only places
# the sandbox can write. This script keeps its own files in
# ~/.paddlesnitch/night-runner (log, copies of reports, bundles of the model's
# branches, steer.md, config, outputs a job keeps between runs); the model can
# read them, never write them. Everything copied out of a run folder is copied
# without following links.
#
# Run it from main, so the copy that runs is one the model can't have edited:
#   bash <(git -C ~/Documents/Code/paddlesnitch.com show origin/main:scripts/night-shift/run.sh)
# Options: --once, --job <name>,
#   --shell <bundle> <cmd…>   check a bundle's branch out in a fresh sandboxed
#                             clone and run a command there (how lead re-measures).
# Stop: touch ~/.paddlesnitch/night-runner/pause
set -uo pipefail

MAIN=~/Documents/Code/paddlesnitch.com
RUNS=~/.paddlesnitch/night-runs
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

mkdir -p "$RUNS" "$RUNNER"/{inbox,done,bundles,out,xdg-config/opencode}
touch "$RUNNER/log.jsonl"
say() { echo "[night $(date +%H:%M)] $*"; }

# From main every time: what runs here is never a copy the model could edit.
from_main() { git -C "$MAIN" show "origin/main:$1"; }

# Copy out of a run folder without following a link anywhere on the way
# (every path component is opened O_NOFOLLOW, relative to its parent).
#   safe_copy file <run folder> <relative path> <destination file> [max bytes]
#   safe_copy tree <run folder> <relative dir>  <destination dir>
safe_copy() {
  python3 -I - "$@" <<'PY'
import os, stat, sys
mode, root, rel, dst = sys.argv[1:5]
cap = int(sys.argv[5]) if len(sys.argv) > 5 else 50_000_000
D = os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY
def open_dir(parts, base):
    fd = os.open(base, D)
    for p in parts:
        nfd = os.open(p, D, dir_fd=fd); os.close(fd); fd = nfd
    return fd
def copy_file(dir_fd, name, out):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_size > cap: os.close(fd); return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with os.fdopen(fd, "rb") as a, open(out, "wb") as b: b.write(a.read(cap))
try:
    parts = [p for p in rel.split("/") if p]
    if mode == "file":
        fd = open_dir(parts[:-1], root); copy_file(fd, parts[-1], dst); os.close(fd)
    else:
        top = open_dir(parts, root)
        os.makedirs(dst, exist_ok=True)
        for dirpath, dirs, files, dfd in os.fwalk(".", dir_fd=top, follow_symlinks=False):
            for f in files:
                try: copy_file(dfd, f, os.path.normpath(os.path.join(dst, dirpath, f)))
                except OSError: pass
        os.close(top)
except OSError:
    pass
PY
}

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
    TMPDIR="$WORK/tmp" NEXT_TELEMETRY_DISABLED=1 OPENCODE_PASSWORD="${OPENCODE_PASSWORD:-}" \
    NIGHT_WORK="$WORK" NIGHT_RUNNER="$RUNNER" \
    XDG_CONFIG_HOME="$RUNNER/xdg-config" XDG_DATA_HOME="$WORK/xdg/data" \
    XDG_STATE_HOME="$WORK/xdg/state" XDG_CACHE_HOME="$WORK/xdg/cache" \
    sandbox-exec -p "$PROFILE" -D HOME="$HOME" -D RUN="$RUN" -D RUNNER="$RUNNER" -D GATE_PORT="$GATE_PORT" "$@")
}

# Its servers, found by the ports they hold and only if they're ours.
kill_ours_on_ports() {
  local p
  for p in $(lsof -ti "tcp:$SERVE_PORT" -sTCP:LISTEN; lsof -ti tcp:3600 -sTCP:LISTEN; lsof -ti tcp:9230 -sTCP:LISTEN) ; do
    ps -o command= -p "$p" | grep -q -e "$RUNS" -e "opencode serve --hostname 127.0.0.1 --port $SERVE_PORT" && kill -9 "$p"
  done 2>/dev/null
}

# Anything still alive from an earlier run (a process that slipped its process
# group) is stopped before any unsandboxed step, and old run folders go. A new
# random folder means an old process's write access points nowhere useful.
clear_old_runs() {
  local pids
  pids=$(lsof -t +D "$RUNS" 2>/dev/null | sort -u)
  [ -n "$pids" ] && { say "stopping leftover processes: $(echo $pids)"; kill -9 $pids 2>/dev/null; }
  kill_ours_on_ports
  rm -rf "${RUNS:?}"/*
}

# A new run folder with a fresh clone of main, installed before the model
# touches it. Packages are copied, never hard-linked to the shared pnpm store.
fresh_run() {  # <branch name>
  git -C "$MAIN" fetch -q origin || return 1
  PROFILE=$(from_main scripts/night-shift/sandbox.sb) || return 1
  clear_old_runs
  RUN=$(mktemp -d "$RUNS/run.XXXXXXXX") || return 1
  CLONE="$RUN/clone"; WORK="$RUN/work"
  mkdir -p "$WORK"/{tmp,xdg}
  local n; for n in "${OUTPUTS[@]}"; do
    if [ -d "$RUNNER/out/$n" ]; then cp -R "$RUNNER/out/$n" "$WORK/$n"; else mkdir -p "$WORK/$n"; fi
  done
  git clone -q --no-checkout --no-hardlinks "$MAIN" "$CLONE" || return 1
  git -C "$CLONE" remote remove origin
  git -C "$CLONE" fetch -q "$MAIN" "+refs/remotes/origin/main:refs/heads/base" || return 1
  git -C "$CLONE" switch -q -c "$1" base || return 1
  (cd "$CLONE" && pnpm install --frozen-lockfile --prefer-offline --package-import-method=clone-or-copy >/dev/null 2>&1) \
    || { say "pnpm install failed"; return 1; }
}

start_gate() {
  from_main scripts/night-shift/ollama-gate.mjs >"$RUNNER/ollama-gate.mjs"
  node "$RUNNER/ollama-gate.mjs" "$GATE_PORT" >>"$RUNNER/gate.log" 2>&1 &
  GATE_PID=$!
}

# What a job keeps between runs: its folder under work/ is saved to
# $RUNNER/out after a run and put back in the next run's work folder.
OUTPUTS=(views footage sweep)

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

record() {  # <report copy> <job> <branch or none>
  python3 -I - "$@" "$RUNNER/log.jsonl" <<'PY'
import json, os, sys, datetime
report, job, branch, log = sys.argv[1:5]
fm = {"result": "no-report"}
if os.path.isfile(report):
    text = open(report, encoding="utf-8", errors="replace").read()
    if text.startswith("---"):
        for line in text.split("---")[1].splitlines()[:12]:
            if ":" in line:
                k, v = line.split(":", 1); fm[k.strip()[:20]] = v.strip()[:200]
fm.update(job=job, branch=branch, report=report if os.path.isfile(report) else None,
          at=datetime.datetime.now().isoformat(timespec="seconds"))
open(log, "a").write(json.dumps(fm) + "\n")
print(fm["result"], fm.get("metric", ""), fm.get("before", ""), "->", fm.get("after", ""))
PY
}

cleanup() {
  [ -n "${SERVE_PID:-}" ] && kill -TERM -- "-$SERVE_PID" 2>/dev/null
  [ -n "${RUN_PID:-}" ] && kill -TERM -- "-$RUN_PID" 2>/dev/null
  [ -n "${GATE_PID:-}" ] && kill "$GATE_PID" 2>/dev/null
  if [ -n "${RUN:-}" ]; then
    pkill -9 -f "$RUN" 2>/dev/null
    lsof -t +D "$RUN" 2>/dev/null | sort -u | xargs kill -9 2>/dev/null
  fi
  kill_ours_on_ports
  SERVE_PID= RUN_PID= GATE_PID=
}
trap 'cleanup; exit 130' INT TERM

run_once() {
  local job stamp branch
  job=$(pick_job)
  case " ${JOBS[*]} " in *" $job "*) ;; *) say "unknown job '$job'"; return 1 ;; esac
  stamp=$(date +%Y%m%d-%H%M)
  branch="night/$job-$stamp"

  fresh_run "$branch" || { say "setup failed"; return 1; }
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
  local prompt="You are the night shift. Job: $job. Branch: $branch (already checked out). Your work folder is $WORK (also \$NIGHT_WORK). Write your report to $WORK/report.md. Read docs/night-shift/README.md, then docs/night-shift/jobs/$job.md, and do exactly one run. Write the report before you stop."
  sb perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' $((RUN_MINUTES * 60)) \
    opencode run --server "http://127.0.0.1:$SERVE_PORT" --agent night-shift --auto --title "night $job $stamp" "$prompt" \
    >>"$RUNNER/inbox/$stamp-$job.log" 2>&1 &
  RUN_PID=$!
  wait "$RUN_PID"; say "opencode exited ($?)"

  # Its branch as a bundle, made in the sandbox (the clone's git config is the model's).
  if [ -n "$(sb git rev-list base..HEAD 2>/dev/null)" ] && sb git bundle create -q "$WORK/branch.bundle" "base..$branch"; then
    :
  else
    branch=none
  fi
  cleanup
  [ "$branch" != none ] && safe_copy file "$RUN" work/branch.bundle "$RUNNER/bundles/$stamp-$job.bundle"
  safe_copy file "$RUN" work/report.md "$RUNNER/inbox/$stamp-$job.md" 200000
  local n; for n in "${OUTPUTS[@]}"; do
    rm -rf "${RUNNER:?}/out/$n.new"; safe_copy tree "$RUN" "work/$n" "$RUNNER/out/$n.new"
    [ -d "$RUNNER/out/$n.new" ] && { rm -rf "${RUNNER:?}/out/$n"; mv "$RUNNER/out/$n.new" "$RUNNER/out/$n"; }
  done
  [ -f "$RUNNER/bundles/$stamp-$job.bundle" ] || branch=none
  say "$(record "$RUNNER/inbox/$stamp-$job.md" "$job" "$branch")"
}

if [ -n "$SHELL_BUNDLE" ]; then
  # Installed from main first, then switched to the model's branch and never
  # reinstalled: nothing from its branch runs outside the sandbox.
  name=$(git bundle list-heads "$SHELL_BUNDLE" | awk '{print $2}' | sed 's#^refs/heads/##' | head -1)
  fresh_run "shell-base" || exit 1
  git -C "$CLONE" fetch -q "$SHELL_BUNDLE" "+refs/heads/$name:refs/heads/$name" || exit 1
  if git -C "$CLONE" diff --name-only base "$name" | grep -qE '(^|/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.cjs)$'; then
    echo "refusing: $name changes dependency files"; exit 1
  fi
  write_config; start_gate
  sb git switch -q "$name" && sb "${SHELL_CMD[@]}"; rc=$?
  cleanup; exit $rc
fi

# Plugged in, the Mac stays awake while this runs (caffeinate -s holds only on
# mains power). On battery it waits.
caffeinate -s -w $$ &
on_power() { pmset -g batt | head -1 | grep -q "AC Power"; }

while true; do
  if ! on_power; then say "on battery; waiting for power"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  if [ -e "$RUNNER/pause" ]; then say "paused (rm $RUNNER/pause to resume)"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  if ! curl -sf http://localhost:11434/api/tags >/dev/null; then say "Ollama isn't running"; [ $ONCE = 1 ] && exit 1; sleep 600; continue; fi
  if model_busy; then say "another model is busy; waiting"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  run_once
  [ $ONCE = 1 ] && exit 0
  sleep 300
done
