#!/usr/bin/env bash
# Reproducible build for the standalone zcode binary.
#
#   bash scripts/build.sh                    # native target -> dist/zcode
#   bash scripts/build.sh all                # all cross targets
#   bash scripts/build.sh bun-linux-x64 ...  # specific bun targets
set -euo pipefail
cd "$(dirname "$0")/.."

# bun's bundler needs the optional-dependency stubs resolvable from the project.
rm -rf node_modules
mkdir -p node_modules/@zcode
cp -R stubs/@zcode/tui node_modules/@zcode/tui
cp -R stubs/playwright-core node_modules/playwright-core

bun run build.ts "$@"
