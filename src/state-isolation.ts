// Shared state-isolation setup for both entry wrappers (src/entry.ts and
// src/npm-entry.ts).
//
// R2.1 / ASD-ST100 D5: the session DB, logs and storage root must follow
// ZCODE_DATA_BASE_DIR instead of staying under $HOME/.zcode/cli where they
// collided with the desktop installation. The runtime natively honors three
// env overrides (its ZCODE_ env→settings mapping feeds storage.dir,
// storage.sessionDbPath, and the log directory), so no vendor patching is
// needed — the wrappers just default them.
//
// Known, documented exceptions that remain under $HOME/.zcode/cli:
//   - setting.json (the CLI settings mirror — the vendor's settings base is
//     hardcoded there and sharing it with the desktop is the interop design),
//   - rollout/model-io debug directories (homedir-hardcoded in the vendor).
// See docs/ENV.md "Data locations".

import { accessSync, constants as fsConstants, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Route mutable runtime state into the isolated data dir (call after ZCODE_DATA_BASE_DIR is decided). */
export function applyStateIsolation(): void {
  const base = process.env.ZCODE_DATA_BASE_DIR as string;
  const isolatedRoot = join(base, ".zcode");
  process.env.ZCODE_STORAGE_DIR ??= isolatedRoot;
  process.env.ZCODE_SESSION_DB_PATH ??= join(isolatedRoot, "cli", "db", "db.sqlite");
  process.env.ZCODE_LOG_DIR ??= join(isolatedRoot, "cli", "log");
}

/** Fail loudly, before any startup work, when the data dir is unusable. */
export function preflightStateDir(): void {
  const base = process.env.ZCODE_DATA_BASE_DIR as string;
  try {
    mkdirSync(base, { recursive: true, mode: 0o700 });
    accessSync(base, fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    throw new Error(
      `zcode: data directory is not usable: ${base}. ` +
        `Set ZCODE_DATA_BASE_DIR to a writable location. ` +
        `(cause: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/**
 * Create-if-absent with O_EXCL semantics: when another process (a second CLI
 * instance or the desktop app) creates the settings file between our check
 * and write, its content wins — our defaults must never truncate it
 * (ASD-ST100 D15). EEXIST is success.
 */
export function ensureCliSettingsFile(settingsPath: string, defaultsJson: string): void {
  mkdirSync(dirname(settingsPath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(settingsPath, defaultsJson, { mode: 0o600, flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== "EEXIST") throw error;
  }
}
