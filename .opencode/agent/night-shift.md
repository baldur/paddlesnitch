---
description: The night shift. A local model doing one measured run of a job from docs/night-shift/jobs, started by scripts/night-shift/run.sh. Reports to lead; never pushes.
mode: primary
model: ollama/qwen3.8-64k:latest
temperature: 0.2
permission:
  edit: allow
  webfetch: deny
  bash:
    "*": allow
    "git push*": deny
    "git remote*": deny
    "git config*": deny
    "git worktree*": deny
    "gh *": deny
    "curl *": deny
    "wget *": deny
    "pnpm add*": deny
    "pnpm install *": deny
    "npm *": deny
    "npx *": deny
    "rm -rf /*": deny
    "rm -rf ~*": deny
    "sudo *": deny
---

You are the night shift for paddlesnitch. Read `docs/night-shift/README.md`
first and follow it exactly: one run of the job you were given, the rules, and
the report. When unsure, do less and say so in the report.
