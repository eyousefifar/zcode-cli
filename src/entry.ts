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
// 4. The bundle occasionally spawns `node --input-type=module --eval <code>
//    [-- <payload>]` helpers (workflow meta evaluation, workflow runs).
//    There is no standalone node inside the binary, so these are replayed.
//    The workflow runner shim hardens its environment by nulling
//    globalThis.process (non-configurable) and replacing Date/Math.random —
//    poisoning that would kill our own process if the shim ran in it. So the
//    helper is replayed in a guarded child copy of this binary (clean
//    globals, real event-loop drain semantics), never in-process.
// 5. Data-dir isolation: mutable state (credentials, provider config,
//    session DB, logs, storage root) lives under ~/.zcode-standalone by
//    default, routed through ZCODE_DATA_BASE_DIR plus the runtime's native
//    override envs (see src/state-isolation.ts). Documented exceptions: the
//    CLI settings mirror stays at $HOME/.zcode/cli (shared with the desktop
//    app), as do the vendor's rollout/model-io debug dirs (see docs/ENV.md).

import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import builtinProviderConfig from "../vendor/zcode-builtin.json" with { type: "file" };
import defaultCliSettings from "../vendor/cli-settings-default.json" with { type: "file" };

import { applyStateIsolation, ensureCliSettingsFile, preflightStateDir } from "./state-isolation.ts";

const BUNFS = "/$bunfs/root/";

// Marker for the helper-replay child (see pass 1/pass 2 below). Chosen to
// never collide with a real CLI argument.
const EVAL_REPLAY_CHILD = "--zcode-eval-replay-child";

// A process reference captured before any replayed module can poison
// globalThis. The workflow shim nulls the global with configurable:false —
// after that, only this private ref reaches the real process.
const realProcess = globalThis.process;

// Minimal environments (cron, CI) lack USER; parts of the runtime's
// credential/provider layer need a username to be resolvable. Empirically
// required: without it model resolution fails with "Select a model before
// continuing" under `env -i`.
if (!process.env.USER) {
  try {
    process.env.USER = userInfo().username;
    process.env.LOGNAME ??= process.env.USER;
  } catch {
    // no passwd entry — leave unset, nothing more we can do
  }
}

// Same class of hardening: homedir() throws when neither HOME nor passwd
// can provide a home. Fall back to "/" so the bundle gets a sane root.
let home: string;
try {
  home = homedir();
} catch {
  home = "/";
}

// Self-respawn normalization: <binary> <bunfs-entry> __zcode-plugin-host ...
if (process.argv[2]?.startsWith(BUNFS)) {
  process.argv.splice(2, 1);
}

// `node --input-type=module --eval <code> [-- <payload>]` helper replay.
// The child argv layout is [bin, bunfs-entry, "--input-type=module",
// "--eval", <code>, "--", <payload>...].
//
// Pass 1 (spawned by the vendor): re-exec this binary with the replay
// marker. The workflow shim nulls globalThis.process and replaces
// Date/Math.random non-restorably, so the module must run in a fresh
// process, not ours; stdin/stdout/stderr stay inherited so the vendor's
// pipes keep working.
if (realProcess.argv[2] === "--input-type=module" && realProcess.argv[3] === "--eval") {
  const child = Bun.spawn(
    [realProcess.execPath, EVAL_REPLAY_CHILD, ...realProcess.argv.slice(2)],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
  // Supervise the child's whole lifetime: the vendor cancels helpers by
  // killing THEIR immediate child (us) and awaits close — if we died without
  // forwarding, the evaluator would survive holding our pipes and defeat the
  // vendor's timeout. Forward, then escalate.
  let escalated = false;
  const forward = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
    if (!escalated) {
      escalated = true;
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, 2_000).unref?.();
    }
  };
  realProcess.once("SIGTERM", () => forward("SIGTERM"));
  realProcess.once("SIGINT", () => forward("SIGINT"));
  if (realProcess.platform !== "win32") realProcess.once("SIGHUP", () => forward("SIGHUP"));
  const code = await child.exited;
  realProcess.exit(code ?? 1);
}

// Pass 2 (the guarded child): normalize argv to the node eval layout —
// [execPath, "[eval]", "--", <payload>...] — import the module, then let the
// event loop drain: the shim never exits itself (process is gone by design)
// and pending timers/stream writes must complete before the process exits.
// Control must not fall through to the vendor import below, hence the else.
if (realProcess.argv[2] === EVAL_REPLAY_CHILD) {
  const argv = realProcess.argv;
  // [bin, bunfs-entry, MARKER, "--input-type=module", "--eval", <code>, ...]
  const code = argv[5] ?? "";
  const payloadStart = argv.indexOf("--", 6);
  const payload = payloadStart === -1 ? [] : argv.slice(payloadStart);
  argv.splice(2, 1); // drop the marker
  realProcess.argv = [realProcess.execPath, "[eval]", ...payload];
  try {
    await import("data:application/javascript;base64," + Buffer.from(code).toString("base64"));
    realProcess.exitCode ??= 0;
    // Falling out of the if/else ends module evaluation; bun then drains the
    // loop and exits with exitCode. A module that leaves a repeating timer
    // keeps the process alive — same as `node --eval`.
  } catch (err) {
    console.error(err);
    realProcess.exit(1);
  }
} else {
  await startCli();
}

async function startCli(): Promise<void> {
  // Isolated state dir — session DB, logs and storage root follow the data
  // dir via the runtime's native override envs (see src/state-isolation.ts).
  // The CLI settings mirror intentionally stays at $HOME/.zcode/cli (shared
  // with the desktop app; documented exception in docs/ENV.md).
  if (!process.env.ZCODE_DATA_BASE_DIR) {
    process.env.ZCODE_DATA_BASE_DIR = join(home, ".zcode-standalone");
  }
  try {
    preflightStateDir();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    realProcess.exit(1);
  }
  applyStateIsolation();

  // Mirror upstream's `ensureCliSettings`: create the CLI settings file at its
  // designed location ($HOME/.zcode/cli/setting.json — the same file the
  // desktop app's CLI engine and the bundled TUI read) if absent — with
  // exclusive creation so a concurrent writer's content is never truncated.
  try {
    ensureCliSettingsFile(
      join(home, ".zcode", "cli", "setting.json"),
      readFileSync(defaultCliSettings, "utf8"),
    );
  } catch {
    // best effort — the runtime tolerates a missing file
  }

  // The vendored TUI (kingsword09/zcode-cli) checks npm for zcode-app-cli
  // updates; this distribution isn't that package, so default the check off.
  process.env.ZCODE_DISABLE_UPDATE_CHECK ??= "1";

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
}
