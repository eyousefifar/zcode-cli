#!/usr/bin/env node
// npm entry point for @eyousefifar/zcode-cli.
//
// Runs the vendored ZCode CLI bundle as-is under node (>=22.5, for
// node:sqlite) or bun. Unlike the compiled binary (src/entry.ts), the
// npm package ships real files, so no argv/virtual-fs repairs are needed —
// only the provider-config and search-tool path setup.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Isolated state dir — see src/entry.ts for rationale.
if (!process.env.ZCODE_DATA_BASE_DIR) {
  process.env.ZCODE_DATA_BASE_DIR = join(homedir(), ".zcode-standalone");
}

if (!process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE) {
  const bundled = join(here, "../vendor/zcode-builtin.json");
  if (existsSync(bundled)) process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = bundled;
}

const appResources = "/Applications/ZCode.app/Contents/Resources";
const bundledTools = [
  ["ZCODE_RG_BINARY", join(appResources, "tools/ripgrep/rg")],
  ["ZCODE_BFS_BINARY", join(appResources, "tools/bfs/bfs")],
  ["ZCODE_UGREP_BINARY", join(appResources, "tools/ugrep/ugrep")],
];
for (const [envVar, toolPath] of bundledTools) {
  if (!process.env[envVar] && existsSync(toolPath)) {
    process.env[envVar] = toolPath;
  }
}

const require = createRequire(import.meta.url);
require("../vendor/zcode.cjs");
