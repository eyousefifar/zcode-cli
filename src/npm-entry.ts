// npm package entry — bundled at publish time (dist-npm/entry.js) so the
// runtime's `require("node:sea")` gets the same build-time shim the compiled
// binary gets. Runs under bun only.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// The runtime keys parts of the provider/credential layer on the unix
// username; minimal environments (cron, CI) lack USER/LOGNAME.
if (!process.env.USER) {
  try {
    process.env.USER = userInfo().username;
    process.env.LOGNAME ??= process.env.USER;
  } catch {
    // no passwd entry
  }
}

// Isolated state dir — see src/entry.ts for rationale. Session DB and logs
// remain under $HOME/.zcode/cli (upstream hardwires them).
if (!process.env.ZCODE_DATA_BASE_DIR) {
  process.env.ZCODE_DATA_BASE_DIR = join(homedir(), ".zcode-standalone");
}

// Vendored TUI: default the zcode-app-cli npm update check off (not our package).
if (process.env.ZCODE_DISABLE_UPDATE_CHECK === undefined) {
  process.env.ZCODE_DISABLE_UPDATE_CHECK = "1";
}

// Mirror upstream's `ensureCliSettings`: create the CLI settings file (its
// designed location, shared with the desktop app's CLI engine) if absent.
try {
  const cliDir = join(homedir(), ".zcode", "cli");
  const cliSettingsPath = join(cliDir, "setting.json");
  if (!existsSync(cliSettingsPath)) {
    mkdirSync(cliDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      cliSettingsPath,
      `${JSON.stringify(JSON.parse(readFileSync(join(here, "../vendor/cli-settings-default.json"), "utf8")), null, 2)}\n`,
      { mode: 0o600 },
    );
  }
} catch {
  // best effort — the runtime tolerates a missing file
}

import { readFileSync } from "node:fs";

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

await import("../vendor/zcode.cjs");
