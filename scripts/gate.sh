#!/usr/bin/env bash
# Quality gate: everything that must pass before a release.
#
#   bash scripts/gate.sh            # offline only (fast, deterministic)
#   RUN_ONLINE=1 bash scripts/gate.sh   # also run the real-API suite
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
step() { echo; echo "=== $1 ==="; }

step "build (native + npm entry)"
bash scripts/build.sh native npm || FAIL=1

step "offline e2e (headless + TUI, mock server, sandboxed)"
bun test test/ || FAIL=1

step "npm entry smoke (bun dist-npm/entry.js --version)"
bun dist-npm/entry.js --version || FAIL=1

step "legacy flag matrix (real API, small quota)"
if [[ "${RUN_ONLINE:-0}" == "1" ]]; then
  bash scripts/test.sh dist/zcode || FAIL=1
else
  echo "skipped (set RUN_ONLINE=1 to include)"
fi

step "performance baseline (startup median, sample)"
bash scripts/perf.sh dist/zcode || FAIL=1

echo
if [[ $FAIL -eq 0 ]]; then echo "GATE: PASS"; else echo "GATE: FAIL"; fi
exit $FAIL
