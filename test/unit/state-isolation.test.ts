// Unit tests for the shared entry wrapper state-isolation helpers
// (src/state-isolation.ts) — R2.1/D5/D15.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyStateIsolation, ensureCliSettingsFile } from "../../src/state-isolation.ts";

let home = "";
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const key of ["ZCODE_DATA_BASE_DIR", "ZCODE_STORAGE_DIR", "ZCODE_SESSION_DB_PATH", "ZCODE_LOG_DIR"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), "zcode-iso-"));
  process.env.ZCODE_DATA_BASE_DIR = join(home, "data");
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true }).catch(() => {});
});

describe("applyStateIsolation", () => {
  test("routes db, logs and storage root under the data dir", () => {
    applyStateIsolation();
    const base = process.env.ZCODE_DATA_BASE_DIR!;
    expect(process.env.ZCODE_STORAGE_DIR).toBe(join(base, ".zcode"));
    expect(process.env.ZCODE_SESSION_DB_PATH).toBe(join(base, ".zcode", "cli", "db", "db.sqlite"));
    expect(process.env.ZCODE_LOG_DIR).toBe(join(base, ".zcode", "cli", "log"));
  });

  test("never overrides explicit user settings", () => {
    process.env.ZCODE_SESSION_DB_PATH = "/custom/db.sqlite";
    process.env.ZCODE_LOG_DIR = "/custom/logs";
    applyStateIsolation();
    expect(process.env.ZCODE_SESSION_DB_PATH).toBe("/custom/db.sqlite");
    expect(process.env.ZCODE_LOG_DIR).toBe("/custom/logs");
    // storage dir still defaults
    expect(process.env.ZCODE_STORAGE_DIR).toContain(".zcode");
  });
});

describe("ensureCliSettingsFile", () => {
  test("creates the file with defaults when absent", async () => {
    const p = join(home, "nested", "setting.json");
    ensureCliSettingsFile(p, '{"a":1}\n');
    expect(JSON.parse(await readFile(p, "utf8"))).toEqual({ a: 1 });
  });

  test("a concurrent creator's content wins (wx, no truncation)", async () => {
    const p = join(home, "setting.json");
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, '{"written":"by-other-process"}\n', { flag: "wx" });
    ensureCliSettingsFile(p, '{"defaults":true}\n');
    expect(JSON.parse(await readFile(p, "utf8"))).toEqual({ written: "by-other-process" });
  });

  test("is idempotent (second call is a no-op)", () => {
    const p = join(home, "setting.json");
    ensureCliSettingsFile(p, '{"a":1}\n');
    expect(() => ensureCliSettingsFile(p, '{"a":2}\n')).not.toThrow();
  });
});
