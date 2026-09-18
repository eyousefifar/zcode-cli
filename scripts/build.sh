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
# runtime's dynamic imports. Overlay order: our fork (packages/tui, seeded from
# kingsword09/zcode-cli MIT — see packages/tui/PROVENANCE.md), then the legacy
# vendor artifact, then the error stub.
bun install --frozen-lockfile
if [[ -f packages/tui/src/index.ts ]]; then
  # Always rebuild the fork: a stale dist silently shipping old UI code is the
  # classic overlay trap.
  (cd packages/tui && bun build src/index.ts --outdir dist --target bun --format esm \
    --external @earendil-works/pi-tui --minify >/dev/null)
fi
mkdir -p node_modules/@zcode/tui/dist
if [[ -f packages/tui/dist/index.js ]]; then
  cp packages/tui/dist/index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: bundling fork packages/tui (our build)"
elif [[ -f vendor/zcode-tui-index.js ]]; then
  cp vendor/zcode-tui-index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: bundling vendored @zcode/tui (legacy fallback)"
else
  cp stubs/@zcode/tui/index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: no TUI artifact found, bundling stub"
fi

bun run build.ts "$@"
