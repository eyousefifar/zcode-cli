#!/usr/bin/env bash
# Quality gate: everything that must pass before a release.
#
#   bash scripts/gate.sh            # offline only (fast, deterministic)
#   RUN_VISUAL=1 bash scripts/gate.sh   # also capture TUI PNGs (artifacts/tui/)
#   RUN_ONLINE=1 bash scripts/gate.sh   # also run the real-API suite
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
step() { echo; echo "=== $1 ==="; }

step "build (fork TUI + native + npm entry)"
bash scripts/build.sh native npm || FAIL=1

step "tier 1: wrapper state-isolation + TUI logic tests (test/unit, test/tui-unit)"
bun test test/unit/ || FAIL=1
bun test test/tui-unit/ || FAIL=1

step "tier 2: in-process whole-app TUI (test/tui-render)"
bun test test/tui-render/ || FAIL=1

step "tier 3: offline e2e (headless + TUI pty, mock server, sandboxed)"
bun test test/headless.e2e.test.ts test/tui.e2e.test.ts || FAIL=1

step "npm entry smoke (bun dist-npm/entry.js --version)"
bun dist-npm/entry.js --version || FAIL=1

step "out-of-checkout binary validation (no repo dependencies)"
VALIDATE_DIR="$(mktemp -d)"
cp dist/zcode "$VALIDATE_DIR/zcode"
chmod +x "$VALIDATE_DIR/zcode"
(
  cd "$VALIDATE_DIR"
  HOME="$VALIDATE_DIR/home" ./zcode --version || exit 1
  # The eval replay re-executes the binary as a child — exercise it from an
  # arbitrary location too.
  HOME="$VALIDATE_DIR/home" ./zcode --input-type=module --eval 'console.log("OOT-EVAL-OK");' | grep -q OOT-EVAL-OK || exit 1
) || FAIL=1
rm -rf "$VALIDATE_DIR"

step "visual gate (tui-shot PNG capture)"
if [[ "${RUN_VISUAL:-0}" == "1" ]]; then
  bun scripts/tui-shot.ts || FAIL=1
else
  echo "skipped (set RUN_VISUAL=1 to capture artifacts/tui/*.png)"
fi

step "legacy flag matrix (real API, small quota)"
if [[ "${RUN_ONLINE:-0}" == "1" ]]; then
  bash scripts/test.sh "$(pwd)/dist/zcode" || FAIL=1
else
  echo "skipped (set RUN_ONLINE=1 to include)"
fi

step "performance baseline (startup median, sample) — ONLINE: real API"
if [[ "${RUN_PERF:-0}" == "1" ]]; then
  bash scripts/perf.sh "$(pwd)/dist/zcode" || FAIL=1
else
  echo "skipped by default (perf makes real authenticated API calls; set RUN_PERF=1)"
fi

echo
if [[ $FAIL -eq 0 ]]; then echo "GATE: PASS"; else echo "GATE: FAIL"; fi
exit $FAIL
