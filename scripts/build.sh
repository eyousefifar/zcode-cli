#!/usr/bin/env bash
# Reproducible build for the standalone zcode binary.
#
#   bash scripts/build.sh                    # native target -> dist/zcode
#   bash scripts/build.sh all                # all cross targets
#   bash scripts/build.sh bun-linux-x64 ...  # specific bun targets
set -euo pipefail
cd "$(dirname "$0")/.."

# Stub packages (@zcode/tui, playwright-core) are file: devDependencies, so
# `bun install` places them in node_modules where bun's bundler resolves the
# runtime's dynamic imports. If the real TUI artifact is vendored, overlay it
# over the stub (kingsword09/zcode-cli, MIT — see vendor/zcode-tui-LICENSE).
bun install --frozen-lockfile 2>/dev/null || bun install
if [[ -f vendor/zcode-tui-index.js ]]; then
  mkdir -p node_modules/@zcode/tui/dist
  cp vendor/zcode-tui-index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: bundling vendored @zcode/tui (real terminal UI)"
else
  mkdir -p node_modules/@zcode/tui/dist
  cp stubs/@zcode/tui/index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: vendor/zcode-tui-index.js missing, bundling stub"
fi

bun run build.ts "$@"
