#!/usr/bin/env bash
# Test matrix for the standalone zcode binary.
# Usage: bash scripts/test.sh [path-to-binary]   (default: ~/.local/bin/zcode)
# API-backed cases hit the real Z.ai endpoint and consume a small amount of
# plan quota. Results are printed as a table; detailed output in /tmp/zcode-test.
set -uo pipefail

Z="${1:-$HOME/.local/bin/zcode}"
OUT=/tmp/zcode-test
rm -rf "$OUT"; mkdir -p "$OUT/work"
PASS=0; FAIL=0; NOTES=()

run_case() { # name expected_exit_pattern command...
  local name="$1"; shift
  local check="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  local rc=0
  ( cd "$OUT/work" && "$@" ) >"$log" 2>&1 || rc=$?
  local ok="FAIL"
  if [[ "$check" == "exit0" && $rc -eq 0 ]] || [[ "$check" == "any" ]]; then ok="PASS"; fi
  if [[ "$check" == exit0 && $rc -ne 0 ]]; then ok="FAIL"; fi
  if [[ "$ok" == PASS ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%-42s %-4s (exit %s)\n' "$name" "$ok" "$rc"
}

api_case() { # name command... — expects clean JSON with .response
  local name="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  local rc=0
  ( cd "$OUT/work" && "$@" ) >"$log" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]] && jq -e '.response' "$log" >/dev/null 2>&1; then
    PASS=$((PASS+1)); printf '%-42s PASS (exit 0, valid response)\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '%-42s FAIL (exit %s)\n' "$name" "$rc"; head -3 "$log" | sed 's/^/    /'
  fi
}

text_case() { # name expected_substring command... — plain-text mode
  local name="$1"; shift
  local want="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  local rc=0
  ( cd "$OUT/work" && "$@" ) >"$log" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]] && grep -qi "$want" "$log"; then
    PASS=$((PASS+1)); printf '%-42s PASS (exit 0, reply ok)\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '%-42s FAIL (exit %s)\n' "$name" "$rc"; head -3 "$log" | sed 's/^/    /'
  fi
}

echo "== binary: $Z"
run_case "--version"            exit0 "$Z" --version
run_case "--help"               exit0 "$Z" --help
run_case "doctor"               exit0 "$Z" doctor
run_case "skills list"          exit0 "$Z" skills list
run_case "commands list"        exit0 "$Z" commands list
run_case "plugins list"         exit0 "$Z" plugins list
run_case "tui (stub)"           any     "$Z" tui
text_case "-p --prepare-storage" "ok"   "$Z" -p "Reply with exactly: ok" --prepare-storage

echo "-- API cases --"
text_case "-p (plain text)"        "ok"   "$Z" -p "Reply with exactly: ok"
api_case "-p --json"              "$Z" -p "Reply with exactly: ok" --json
api_case "-p --output-format json" "$Z" -p "Reply with exactly: ok" --output-format json
api_case "-p --output-format stream-json" "$Z" -p "Reply with exactly: ok" --output-format stream-json
text_case "-p --mode plan"        "ok"   "$Z" -p "Reply with exactly: ok" --mode plan
text_case "-p --mode edit"        "ok"   "$Z" -p "Reply with exactly: ok" --mode edit
text_case "-p --mode build"       "ok"   "$Z" -p "Reply with exactly: ok" --mode build
text_case "-p --mode yolo"        "ok"   "$Z" -p "Reply with exactly: ok" --mode yolo
api_case "-p --verbose"           "$Z" -p "Reply with exactly: ok" --verbose --json
api_case "-p --no-color"          "$Z" -p "Reply with exactly: ok" --no-color --json
api_case "-p --locale zh-CN"      "$Z" -p "Reply with exactly: ok" --locale zh-CN --json
api_case "-p --surface terminal"  "$Z" -p "Reply with exactly: ok" --surface terminal --json
api_case "-p -f (force)"          "$Z" -p "Reply with exactly: ok" -f --json

echo 'hello from attach test' > "$OUT/work/attach-file.txt"
api_case "-p --attach"            "$Z" -p "What is the last word of the attached file? Reply with only that word." --attach "$OUT/work/attach-file.txt" --json
api_case "-p --cwd"               "$Z" -p "Reply with exactly: ok" --cwd "$OUT/work" --json
api_case "-p --disallowed-tools"  "$Z" -p "Reply with exactly: ok" --disallowed-tools "Bash,Edit" --json
# NOTE: --allowed-tools/--disallowedTools and --max-turns are advertised in
# --help but NOT in the actual argument parser; --target is mutually exclusive
# with -p. See docs/OPTIONS.md.

echo "-- session continuity --"
SID=$( (cd "$OUT/work" && "$Z" -p "Remember the word BANANA. Reply ok." --json 2>/dev/null | jq -r '.sessionId // empty') )
if [[ -n "${SID:-}" ]]; then
  PASS=$((PASS+1)); printf '%-42s PASS (session %s)\n' "resume: got sessionId" "${SID:0:13}..."
  api_case "--resume <id>"  "$Z" --resume "$SID" -p "What word did I ask you to remember? Reply with only that word." --json
else
  FAIL=$((FAIL+1)); printf '%-42s FAIL\n' "resume: got sessionId"
fi
api_case "-c (continue latest)"   "$Z" -c -p "Reply with exactly: ok" --json

echo
echo "== RESULT: $PASS passed, $FAIL failed (details in $OUT)"
[[ $FAIL -eq 0 ]]
