// Whole-app TUI test, entirely in-process: runTui() receives our
// VirtualTerminal through the [fork] seam (TuiOptions.terminal), a stubbed
// RuntimeAdapter streams canned events, and assertions read the emulated
// @xterm/headless screen. No binary, no pty, no network, no credentials.
//
// Typing convention: split text and Enter into separate writes with a settle
// pause (a synchronous "\r" in the same chunk races the editor's submit path),
// and use double-Enter for slash commands (first Enter accepts the
// autocomplete completion — same as a real terminal).

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTui } from "../../packages/tui/src/index.ts";
import { VirtualTerminal, type QueryScheme } from "../helpers/tui-virtual.ts";
import type { TerminalScreen } from "../helpers/terminal-screen.ts";

let home = "";
let dataDir = "";
const savedEnv: Record<string, string | undefined> = {};

async function waitFor(
  screen: TerminalScreen,
  what: string,
  predicate: (text: string) => boolean,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await screen.settled();
    const text = screen.screenText();
    if (predicate(text)) return text;
    await Bun.sleep(20);
  }
  throw new Error(`in-process wait timed out (${what}).\n--- screen ---\n${screen.screenText()}`);
}

beforeAll(async () => {
  for (const key of ["HOME", "USER", "ZCODE_DATA_BASE_DIR", "ZCODE_DISABLE_UPDATE_CHECK",
    "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE", "ZCODE_TUI_MODE"]) {
    savedEnv[key] = process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), "zcode-tui-inproc-"));
  dataDir = join(home, "zcode-data");
  await mkdir(dataDir, { recursive: true });
  process.env.HOME = home;
  process.env.USER ??= "tester";
  process.env.ZCODE_DATA_BASE_DIR = dataDir;
  process.env.ZCODE_DISABLE_UPDATE_CHECK = "1";
  delete process.env.ZCODE_TUI_MODE;
  // Coding-plan gate: an account:-prefixed selection passes preflight without
  // any real credentials (validated by the runtime in production).
  process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(dataDir, "provider_config.json");
  await writeFile(process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, JSON.stringify({
    schemaVersion: 1,
    config: {
      defaultModelSelection: { providerId: "account:test-plan", modelId: "test-model" },
    },
  }));
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true }).catch(() => {});
});

interface BootedSession {
  term: VirtualTerminal;
  tui: Promise<void>;
  turnCount(): number;
  lastPrompt(): string;
}

async function bootToReady(
  scheme: QueryScheme = "dark",
  response = "IN-PROCESS-TURN-OK works",
): Promise<BootedSession> {
  let count = 0;
  let last = "";
  const term = new VirtualTerminal(scheme);
  const tui = runTui({
    terminal: term,
    version: "0.0.0-test",
    workspaceDirectory: home,
    theme: "auto",
    submitPrompt: async (input, options) => {
      count += 1;
      last = String(input);
      options.onEvent?.({ kind: "text_start", messageId: "m1" });
      options.onEvent?.({ kind: "text_delta", delta: response, messageId: "m1" });
      options.onEvent?.({ kind: "text_end", messageId: "m1" });
    },
    subscribeSessionEvents: () => () => {},
    listSkills: async () => ({ skills: [], totalDiscovered: 0 }),
  });
  await waitFor(term.screen, "welcome", (t) => t.includes("Ask a task about this workspace"));
  return { term, tui, turnCount: () => count, lastPrompt: () => last };
}

async function typeLine(session: BootedSession, text: string): Promise<void> {
  session.term.type(text);
  await Bun.sleep(250);
  session.term.type("\r");
}

async function submitCommand(session: BootedSession, command: string): Promise<void> {
  await typeLine(session, command); // first Enter accepts the completion
  await Bun.sleep(250);
  session.term.type("\r"); // second Enter submits
}

async function exitSession(session: BootedSession): Promise<void> {
  await submitCommand(session, "/exit");
  await Promise.race([
    session.tui,
    new Promise((_, reject) => setTimeout(() => reject(new Error("runTui did not resolve after /exit")), 10_000)),
  ]);
  await session.term.dispose();
}

describe("tui in-process (terminal seam)", () => {
  test("boots to the welcome screen", async () => {
    const session = await bootToReady();
    const text = session.term.screen.screenText();
    expect(text).toContain("Ask a task about this workspace");
    expect(text).toContain("/help");
    await exitSession(session);
  }, 30_000);

  test("streams a stubbed turn end-to-end through the real component tree", async () => {
    const session = await bootToReady();
    await typeLine(session, "hello stub");
    await waitFor(session.term.screen, "turn response", (t) => t.includes("IN-PROCESS-TURN-OK"));
    expect(session.turnCount()).toBe(1);
    expect(session.lastPrompt()).toContain("hello stub");
    await exitSession(session);
  }, 30_000);

  test("dark and light schemes resolve deterministically (query responder)", async () => {
    const dark = await bootToReady("dark");
    const light = await bootToReady("light");
    expect(dark.term.screen.screenText()).toContain("Ask a task about this workspace");
    expect(light.term.screen.screenText()).toContain("Ask a task about this workspace");
    const fgSignature = (term: VirtualTerminal): string => {
      const snap = term.screen.snapshot();
      const parts: string[] = [];
      for (let row = 0; row < snap.rows; row++) {
        for (let col = 0; col < snap.cols; col++) {
          const cell = term.screen.cellAt(col, row);
          if (cell && cell.chars.trim()) parts.push(String(cell.fg));
        }
      }
      return parts.join(",");
    };
    expect(fgSignature(dark.term)).not.toBe(fgSignature(light.term));
    await exitSession(dark);
    await exitSession(light);
  }, 40_000);

  test("/status opens the real status panel (not the autocomplete popup)", async () => {
    const session = await bootToReady();
    await submitCommand(session, "/status");
    await waitFor(session.term.screen, "status panel", (t) =>
      t.includes("Detailed session information"));
    await exitSession(session);
  }, 30_000);
});
