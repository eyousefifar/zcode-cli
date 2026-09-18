#!/usr/bin/env node
// npm entry point for @eyousefifar/zcode-cli.
//
// Runs the vendored ZCode CLI bundle as-is under node (>=22.5, for
// node:sqlite) or bun. Unlike the compiled binary (src/entry.ts), the
// npm package ships real files, so no argv/virtual-fs repairs are needed —
// only the provider-config and search-tool path setup.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// The runtime keys parts of the provider/credential layer on the unix
// username (see src/entry.ts).
if (!process.env.USER) {
  try {
    process.env.USER = userInfo().username;
    process.env.LOGNAME ??= process.env.USER;
  } catch {
    // no passwd entry
  }
}

// Isolated state dir — see src/entry.ts for rationale.
if (!process.env.ZCODE_DATA_BASE_DIR) {
  process.env.ZCODE_DATA_BASE_DIR = join(homedir(), ".zcode-standalone");
}

// Vendored TUI: default the zcode-app-cli npm update check off (not our package).
if (process.env.ZCODE_DISABLE_UPDATE_CHECK === undefined) {
  process.env.ZCODE_DISABLE_UPDATE_CHECK = "1";
}

// Mirror upstream's `ensureCliSettings` (see src/entry.ts).
import defaultCliSettings from "../vendor/cli-settings-default.json" with { type: "json" };
try {
  const cliDir = join(process.env.ZCODE_DATA_BASE_DIR, ".zcode", "cli");
  const cliSettingsPath = join(cliDir, "setting.json");
  if (!existsSync(cliSettingsPath)) {
    mkdirSync(cliDir, { recursive: true, mode: 0o700 });
    writeFileSync(cliSettingsPath, `${JSON.stringify(defaultCliSettings, null, 2)}\n`, { mode: 0o600 });
  }
} catch {
  // best effort
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
