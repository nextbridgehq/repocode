# CLAUDE.md

Read [AGENTS.md](AGENTS.md). It is the single source of truth for working in this repository —
layout, commands, conventions, the traps, and the benchmark rules. This file deliberately does
not restate any of it, because two copies of the same instructions drift apart and the stale
one gets followed.

A few Claude Code specifics on top of that:

- **`docs/` is gitignored.** Plans and scratch analysis belong there and stay local. Do not
  commit them.
- **Commit messages carry no `Co-Authored-By` trailer** for Claude or any other bot.
- **Do not push.** Ask first, every time — prior permission to push does not carry forward to
  the next push.
- **Benchmark runs are long.** A full SWE-bench Lite pass takes hours and django instances run
  ~17 minutes each. Run them in the background and watch the result CSV's row count for
  progress; process-liveness checks on Windows have produced repeated false "the run died"
  alarms. `packages/bench` resumes from whatever rows already exist, so an interrupted run can
  simply be restarted.
