// Offline sandbox e2e for the TUI: the compiled binary in a real pty against
// the mock model server. Asserts on the emulated screen, with the mock's
// sentinel serving as the "turn rendered end-to-end" completion signal.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createSandbox, type Sandbox } from "./helpers/sandbox.ts";
import { startModelServer, type ModelServer } from "./helpers/model-server.ts";
import { startTui, type TuiSession } from "./helpers/tui-session.ts";

let sandbox: Sandbox;
let server: ModelServer;
const SENTINEL = "TUI-MOCKED-RESPONSE-OK";

beforeAll(async () => {
  sandbox = await createSandbox();
  server = await startModelServer({ sentinel: SENTINEL });
  // The TUI login gate requires standalone coding-plan state: the machine's
  // encrypted login credentials plus an account-provider selection.
  await sandbox.installCredentials();
  await sandbox.writeProviderFixture({ baseUrl: `${server.url}` });
  await sandbox.writeAccountSelection();
}, 30_000);

afterAll(async () => {
  await server?.close();
  await sandbox?.dispose();
}, 30_000);

// Model traffic must reach the mock: redirect the endpoint/business bases.
function tuiEnv(): Record<string, string> {
  return { ZAI_BUSINESS_BASE_URL: server.url, ZCODE_BASE_URL: server.url };
}

async function withTui(fn: (tui: TuiSession) => Promise<void>) {
  const tui = await startTui(sandbox, ["tui"], { extraEnv: tuiEnv() });
  try {
    await fn(tui);
  } finally {
    await tui.close();
  }
}

describe("tui offline", () => {
  test("boots to the ready screen", async () => {
    await withTui(async (tui) => {
      const text = tui.screenText();
      expect(text).toMatch(/ZCODE\s+v0\.16\.5/);
      expect(text).toContain("Ask a task about this workspace");
    });
  }, 60_000);

  test("submitting a prompt renders the mocked response (full pipeline)", async () => {
    await withTui(async (tui) => {
      // Input must NOT contain the sentinel: the first occurrence must be
      // the mocked response streaming back through the whole pipeline.
      tui.type("Say hi\r");
      await tui.waitForText("mock/mock-model", 30_000);
      await tui.waitForText(SENTINEL, 45_000);
      const text = tui.screenText();
      expect(text).toContain(SENTINEL);
      expect(text).toContain("mock/mock-model");
      expect(server.requests().length).toBeGreaterThan(0);
      const last = server.requests().at(-1)!;
      expect(last.stream).toBe(true);
    });
  }, 120_000);

  test("/status opens the status detail panel", async () => {
    await withTui(async (tui) => {
      tui.type("/status\r");
      await tui.waitForText(/Status|Session|Model/i, 15_000);
      tui.type("\u001b"); // Esc closes overlays
      await Bun.sleep(500);
    });
  }, 60_000);

  test("/help lists commands", async () => {
    await withTui(async (tui) => {
      tui.type("/help\r");
      await tui.waitForText(/help|commands/i, 15_000);
      tui.type("\u001b");
      await Bun.sleep(500);
    });
  }, 60_000);

  test("/exit terminates cleanly with code 0", async () => {
    const tui = await startTui(sandbox, ["tui"]);
    tui.type("/exit\r");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && tui.exitCode() === null) await Bun.sleep(50);
    expect(tui.exitCode()).toBe(0);
    await tui.close();
  }, 60_000);
});
