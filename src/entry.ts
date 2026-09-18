// Standalone wrapper for the ZCode CLI bundle (vendor/zcode.cjs).
//
// The bundle is written to run as `node zcode.cjs` (or under Electron with
// ELECTRON_RUN_AS_NODE=1). Compiling it into a single binary with
// `bun build --compile` changes a few environment assumptions, which this
// shim repairs before handing control to the bundle:
//
// 1. The builtin provider registry is resolved relative to the entry script
//    (or from a Node SEA asset). Neither exists in a compiled binary, so we
//    embed the config as an asset and point the CLI's env override at it.
// 2. Search binaries (ripgrep/bfs/ugrep) are picked up from the desktop
//    app's Resources dir when the app is installed; otherwise the bundle
//    falls back to `rg`/`bfs`/`ugrep` on PATH.
// 3. The bundle re-executes itself for plugin hosts with the entry path as
//    an argument; in a compiled binary that path is the bun virtual-fs
//    marker (/$bunfs/root/...), which we strip so it isn't parsed as a
//    positional.
// 4. The bundle occasionally spawns `node --input-type=module --eval <code>`
//    helpers. There is no standalone node inside the binary, so these are
//    replayed in-process via a data: import.

import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import builtinProviderConfig from "../vendor/zcode-builtin.json" with { type: "file" };
import defaultCliSettings from "../vendor/cli-settings-default.json" with { type: "file" };

const BUNFS = "/$bunfs/root/";

// The runtime keys parts of the provider/credential layer on the unix
// username; under `env -i`-style minimal environments USER is absent and
// model resolution fails with "Select a model before continuing".
if (!process.env.USER) {
  try {
    process.env.USER = userInfo().username;
    process.env.LOGNAME ??= process.env.USER;
  } catch {
    // no passwd entry — leave unset, nothing more we can do
  }
}

// Keep standalone state (~/.zcode-standalone/.zcode/v2) separate from the
// desktop app's store (~/.zcode/v2): the CLI's login writes account state in
// a shape the app doesn't share, and vice versa. Override with
// ZCODE_DATA_BASE_DIR to point anywhere else (e.g. $HOME to share).
if (!process.env.ZCODE_DATA_BASE_DIR) {
  process.env.ZCODE_DATA_BASE_DIR = join(homedir(), ".zcode-standalone");
}

// Mirror upstream's `ensureCliSettings`: the runtime expects
// <data-dir>/.zcode/cli/setting.json to exist (e.g. the TUI reads ui.locale
// on submit). Create it from the shipped defaults when absent.
try {
  const cliDir = join(process.env.ZCODE_DATA_BASE_DIR, ".zcode", "cli");
  const cliSettingsPath = join(cliDir, "setting.json");
  if (!existsSync(cliSettingsPath)) {
    mkdirSync(cliDir, { recursive: true, mode: 0o700 });
    writeFileSync(cliSettingsPath, readFileSync(defaultCliSettings), { mode: 0o600 });
  }
} catch {
  // best effort — the runtime tolerates a missing file except for some
  // TUI code paths.
}

// The vendored TUI (kingsword09/zcode-cli) checks npm for zcode-app-cli
// updates; this distribution isn't that package, so default the check off.
process.env.ZCODE_DISABLE_UPDATE_CHECK ??= "1";

// Self-respawn normalization: <binary> <bunfs-entry> __zcode-plugin-host ...
if (process.argv[2]?.startsWith(BUNFS)) {
  process.argv.splice(2, 1);
}

// `node --input-type=module --eval <code>` helper rewrites, replayed in-process.
if (process.argv[1] === "--input-type=module" && process.argv[2] === "--eval") {
  const code = process.argv[3] ?? "";
  try {
    await import("data:application/javascript;base64," + Buffer.from(code).toString("base64"));
    process.exit(process.exitCode ?? 0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (!process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE && existsSync(builtinProviderConfig)) {
  process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtinProviderConfig;
}

const appResources = "/Applications/ZCode.app/Contents/Resources";
const bundledTools: Array<[string, string]> = [
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
