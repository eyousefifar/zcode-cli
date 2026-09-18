#!/usr/bin/env bash
# Reproducible build for the standalone zcode binary.
#
#   bash scripts/build.sh                    # native target -> dist/zcode
#   bash scripts/build.sh all                # all cross targets
#   bash scripts/build.sh bun-linux-x64 ...  # specific bun targets
set -euo pipefail
cd "$(dirname "$0")/.."

# pi-tui (+ its pure-JS deps) is a real dev dependency; the TUI wrapper
# package (@zcode/tui, kingsword09/zcode-cli, MIT — see
# vendor/zcode-tui-LICENSE) is not published, so we overlay its built
# artifact into node_modules where bun's bundler can resolve the runtime's
# dynamic `import("@zcode/tui")`.
bun install --frozen-lockfile 2>/dev/null || bun install
rm -rf node_modules/@zcode/tui
mkdir -p node_modules/@zcode/tui/dist
if [[ -f vendor/zcode-tui-index.js ]]; then
  cp stubs/@zcode/tui-real/package.json node_modules/@zcode/tui/package.json
  cp vendor/zcode-tui-index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: bundling vendored @zcode/tui (real terminal UI)"
else
  cp -R stubs/@zcode/tui node_modules/@zcode/tui
  echo "TUI: vendor/zcode-tui-index.js missing, bundling stub"
fi

bun run build.ts "$@"
