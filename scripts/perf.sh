#!/usr/bin/env bash
# Performance baseline for the standalone zcode binary (bun-only).
#
#   bash scripts/perf.sh [path-to-binary]
#
# ONLINE by design: turn-latency and CPU-sample sections call the real API with
# the developer's credentials. The gate keeps this behind RUN_PERF=1.
# Measures: startup latency (--version, 10 runs), peak RSS, short headless
# turn latency, and a macOS `sample` CPU call-tree during a live turn.
set -uo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "perf.sh: macOS-only tooling (/usr/bin/time -l, sample) — refusing to produce garbage measurements on $(uname)."
  exit 1
fi

Z="${1:-dist/zcode}"
[[ -x "$Z" ]] || { echo "perf.sh: binary not executable: $Z"; exit 1; }
OUT=/tmp/zcode-perf
rm -rf "$OUT"; mkdir -p "$OUT"

fail=0
echo "== binary: $Z"
stat -f "size: %z bytes" "$Z"

echo "== startup (--version), 10 runs =="
: > "$OUT/startup.txt"
for i in $(seq 1 10); do
  { /usr/bin/time -l "$Z" --version; } 2>&1 | grep -E "real|maximum resident" | tr '\n' ' ' >> "$OUT/startup.txt" || true
  echo " [run $i]" >> "$OUT/startup.txt"
done
grep -oE "[0-9]+\.[0-9]+ real" "$OUT/startup.txt" | grep -oE "[0-9]+\.[0-9]+" > "$OUT/startup_seconds.txt"
[[ -s "$OUT/startup_seconds.txt" ]] || { echo "perf.sh: no startup measurements produced"; fail=1; }
median=$(sort -n "$OUT/startup_seconds.txt" | awk '{a[NR]=$1} END {if (NR%2) print a[int(NR/2)+1]; else print (a[int(NR/2)]+a[int(NR/2)+1])/2}')
echo "startup real (s): median=$median min=$(sort -n "$OUT/startup_seconds.txt" | head -1) max=$(sort -n "$OUT/startup_seconds.txt" | tail -1)"
peakrss=$(grep -oE "maximum resident set size [0-9]+" "$OUT/startup.txt" | grep -oE "[0-9]+$" | sort -n | tail -1)
echo "startup peak RSS (bytes, max): ${peakrss:-n/a}"

echo "== short --json turn latency, 5 runs (real API/auth) =="
: > "$OUT/turn.txt"
for i in $(seq 1 5); do
  { /usr/bin/time -l "$Z" -p "Reply with exactly: ok" --json; } >/dev/null 2>"$OUT/turn_$i.txt" || true
  grep -oE "[0-9]+\.[0-9]+ real" "$OUT/turn_$i.txt" | grep -oE "[0-9]+\.[0-9]+" >> "$OUT/turn.txt" || true
done
echo "turn real (s): median=$(sort -n "$OUT/turn.txt" | awk '{a[NR]=$1} END {if (NR%2) print a[int(NR/2)+1]; else print (a[int(NR/2)]+a[int(NR/2)+1])/2}') min=$(sort -n "$OUT/turn.txt" | head -1) max=$(sort -n "$OUT/turn.txt" | tail -1)"

echo "== CPU sample during a live headless turn =="
export ZCODE_DATA_BASE_DIR="${ZCODE_DATA_BASE_DIR:-$HOME/.zcode-standalone}"
"$Z" -p "Count slowly from 1 to 30, one number per line." --json >/dev/null 2>&1 &
PID=$!
sleep 1.5
sample "$PID" 3 -file "$OUT/cpu.sample.txt" >/dev/null 2>&1 || true
wait "$PID" || true
if [[ -s "$OUT/cpu.sample.txt" ]]; then
  cp "$OUT/cpu.sample.txt" "$OUT/cpu.flamegraph-data.txt"
  echo "cpu sample saved: $OUT/cpu.sample.txt (call tree; import into speedscope/Instruments for flamegraph view)"
  grep -E "^\s+[0-9]{3,}" "$OUT/cpu.sample.txt" | head -8 || true
else
  echo "(sample unavailable — process finished before sampling)"
fi

echo "== results in $OUT =="
if [[ $fail -ne 0 ]]; then echo "perf.sh: FAILED (missing measurements above)"; exit 1; fi
