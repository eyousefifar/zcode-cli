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
  // The TUI login gate requires standalone coding-plan state: synthetic
  // credentials (fabricated, fixed test secret — never the developer's real
  // login) plus an account-provider selection.
  await sandbox.installSyntheticCredentials();
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

async function withTui(fn: (tui: TuiSession) => Promise<void>, options: { respondQueries?: "dark" | "light" | "none" } = {}) {
  const tui = await startTui(sandbox, { args: ["tui"], extraEnv: tuiEnv(), respondQueries: options.respondQueries });
  try {
    await fn(tui);
  } finally {
    await tui.close();
  }
}

// Type a slash command with the accept-then-submit double Enter (the first
// Enter accepts the autocomplete completion, exactly as on a real terminal).
async function typeCommand(tui: TuiSession, command: string): Promise<void> {
  tui.type(command);
  await Bun.sleep(400);
  tui.type("\r");
  await Bun.sleep(400);
  tui.type("\r");
}

describe("tui offline", () => {
  test("boots to the ready screen", async () => {
    await withTui(async (tui) => {
      const text = tui.screenText();
      expect(text).toMatch(/ZCODE\s+v0\.16\.9/);
      expect(text).toContain("Ask a task about this workspace");
    });
  }, 60_000);

  test("submitting a prompt renders the mocked response (full pipeline)", async () => {
    await withTui(async (tui) => {
      // Input must NOT contain the sentinel: the first occurrence must be
      // the mocked response streaming back through the whole pipeline.
      tui.type("Say hi\r");
      await tui.waitForText("mock/mock-model", 60_000);
      await tui.waitForText(SENTINEL, 90_000);
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
      await typeCommand(tui, "/status");
      // Panel content is unique — the autocomplete popup says "Inspect
      // detailed runtime and session status", which must NOT count.
      const buffer = await tui.waitForBuffer("Detailed session information", 20_000);
      expect(buffer).toContain("Detailed session information. The compact statusline remains intentionally minimal.");
      tui.type("\u001b"); // Esc closes overlays
      await Bun.sleep(500);
    });
  }, 60_000);

  test("/help lists the runtime slash commands", async () => {
    await withTui(async (tui) => {
      await typeCommand(tui, "/help");
      const text = await tui.waitForText("Use /help <command> for details.", 20_000);
      expect(text).toContain("Slash commands:");
      expect(text).toContain("/compact [instructions]");
      tui.type("\u001b");
      await Bun.sleep(500);
    });
  }, 60_000);

  test("/login suspends the UI, runs the login command, resumes (R1.7)", async () => {
    // ZCODE_TUI_LOGIN_CMD overrides the external login program: the TUI must
    // stop the UI (restoring terminal state), run the command with inherited
    // stdio, then resume in place — all without losing the session.
    const tui = await startTui(sandbox, {
      args: ["tui"],
      extraEnv: { ZCODE_TUI_LOGIN_CMD: "echo LOGIN-SUSPEND-MARKER-RAN" },
    });
    try {
      await typeCommand(tui, "/login");
      // The command's transient echo is wiped by pi-tui redraws; the durable
      // signal is the post-login notice. Which notice appears depends on the
      // provider fixture (access-configured vs not), but EITHER proves the
      // suspend ran the command and resumed the UI.
      const text = await tui.waitScreen(
        "post-login notice",
        (t) => t.includes("Model access configured") || t.includes("Login command finished"),
        90_000,
      );
      expect(text).toMatch(/Model access configured|Login command finished/);
      tui.type("/exit\r");
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && tui.exitCode() === null) await Bun.sleep(50);
      expect(tui.exitCode()).toBe(0);
    } finally {
      await tui.close();
    }
  }, 150_000);

  test("/exit terminates cleanly with code 0", async () => {
    const tui = await startTui(sandbox, { args: ["tui"] });
    tui.type("/exit\r");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && tui.exitCode() === null) await Bun.sleep(50);
    expect(tui.exitCode()).toBe(0);
    await tui.close();
  }, 60_000);
});

// Agent-loop tests (R3.1): the model issues a real tool_use; the TUI must
// raise the permission dialog (build mode + high-risk command), route the
// decision back to the model, and execute only when allowed.
//
// Test-design constraints (learned the hard way — see ASD-ST100 D22/D23):
//   - `echo …` is auto-allowed as a safe command (no dialog): use a write
//     command such as `touch` to reach the permission flow.
//   - The ZAI_BUSINESS_BASE_URL redirect used by the plain-text tests routes
//     the session through the coding-plan business API, where the
//     interactive tool loop does NOT run (D23). These tests must rely on the
//     provider fixture's baseUrl only — no tuiEnv().
describe("tui agent loop", () => {
  const FOLLOW_UP = "PERM-FOLLOWUP-OK";
  let markerSeq = 0;

  function armBashScenario(server: ModelServer, command: string): void {
    server.setScenario({
      kind: "tool-use",
      toolName: "Bash",
      toolInput: { command, description: "create the marker file" },
      followUpText: FOLLOW_UP,
    });
  }

  async function workspaceFiles(): Promise<string[]> {
    return Array.fromAsync(new Bun.Glob("*").scan({ cwd: sandbox.cwd }));
  }

  test("permission dialog: Allow once executes the tool and round-trips the result", async () => {
    const TOOL_MARKER = `perm-allow-${++markerSeq}.txt`;
    armBashScenario(server, `touch ${TOOL_MARKER}`);
    try {
      const tui = await startTui(sandbox, { args: ["tui"] });
      try {
        tui.type("Use the bash tool\r");
        // The dialog must present the tool, the risk and the command.
        await tui.waitForText("Permission", 30_000);
        const dialog = tui.screenText();
        expect(dialog).toContain("Bash");
        expect(dialog).toContain("Allow once");
        expect(dialog).toContain(TOOL_MARKER);
        // Number shortcut 1 = "Allow once".
        tui.type("1");
        await tui.waitForText(FOLLOW_UP, 90_000);
        // The tool actually ran in the sandbox workspace.
        expect(await workspaceFiles()).toContain(TOOL_MARKER);
        // The tool result reached the model in a tool-role message.
        const last = server.requests().at(-1)!;
        const messages = ((last.body as any)?.messages ?? []) as Array<{ role: string }>;
        expect(messages.some((m) => m.role === "tool")).toBe(true);
        tui.type("/exit\r");
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && tui.exitCode() === null) await Bun.sleep(50);
        expect(tui.exitCode()).toBe(0);
      } finally {
        await tui.close();
      }
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 180_000);

  test("permission dialog: Deny skips the tool and reports back to the model", async () => {
    const TOOL_MARKER = `perm-deny-${++markerSeq}.txt`;
    armBashScenario(server, `touch ${TOOL_MARKER}`);
    try {
      const tui = await startTui(sandbox, { args: ["tui"] });
      try {
        tui.type("Use the bash tool\r");
        await tui.waitForText("Permission", 30_000);
        // Number shortcut 4 = "Deny".
        tui.type("4");
        await tui.waitForText(FOLLOW_UP, 90_000);
        // The tool must NOT have run.
        expect(await workspaceFiles()).not.toContain(TOOL_MARKER);
        // The denial reached the model: the follow-up's tool-role message
        // must carry the rejection (the command echo alone stays in history).
        const last = server.requests().at(-1)!;
        const messages = (last.body as { messages?: Array<{ role: string; content?: string }> }).messages ?? [];
        const toolMsgs = messages.filter((m) => m.role === "tool");
        expect(toolMsgs.length).toBeGreaterThan(0);
        expect(toolMsgs.map((m) => m.content ?? "").join(" ")).toMatch(/deny|denied|permission/i);
      } finally {
        await tui.close();
      }
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 180_000);

  test("permission dialog: Esc cancels the request", async () => {
    const TOOL_MARKER = `perm-esc-${++markerSeq}.txt`;
    armBashScenario(server, `touch ${TOOL_MARKER}`);
    try {
      const tui = await startTui(sandbox, { args: ["tui"] });
      try {
        tui.type("Use the bash tool\r");
        await tui.waitForText("Permission", 30_000);
        tui.type("\u001b"); // Esc — cancel
        await tui.waitForText(FOLLOW_UP, 90_000);
        expect(await workspaceFiles()).not.toContain(TOOL_MARKER);
        // The cancellation reached the model as the tool result.
        const last = server.requests().at(-1)!;
        const messages = ((last.body as any)?.messages ?? []) as Array<{ role: string; content?: string }>;
        const toolMsgs = messages.filter((m) => m.role === "tool");
        expect(toolMsgs.length).toBeGreaterThan(0);
        expect(toolMsgs.map((m) => m.content ?? "").join(" ")).toMatch(/cancel|deny|denied/i);
      } finally {
        await tui.close();
      }
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 180_000);
});

// Command/keybinding scenarios (R3.2): the high-traffic TUI surfaces, driven
// through the real binary in a real pty.
describe("tui commands", () => {
  async function withTuiCmd(fn: (tui: TuiSession) => Promise<void>): Promise<void> {
    const tui = await startTui(sandbox, { args: ["tui"] });
    try {
      await fn(tui);
    } finally {
      await tui.close();
    }
  }

  test("/model opens the Select model picker and Esc closes it", async () => {
    await withTuiCmd(async (tui) => {
      await typeCommand(tui, "/model");
      await tui.waitForText("Select model", 20_000);
      expect(tui.screenText()).toContain("Current model:");
      tui.type("\u001b");
      await Bun.sleep(400);
    });
  }, 60_000);

  test("/diff opens the diff browser; a clean tree reports clean", async () => {
    await withTuiCmd(async (tui) => {
      await typeCommand(tui, "/diff");
      await tui.waitForText("Select current workspace changes", 20_000);
      tui.type("\r"); // pick the first source (current workspace)
      await tui.waitForText("Working tree is clean", 20_000);
      tui.type("\u001b");
      await Bun.sleep(400);
    });
  }, 60_000);

  test("/search without arguments shows usage", async () => {
    await withTuiCmd(async (tui) => {
      await typeCommand(tui, "/search");
      await tui.waitForText("Usage: /search", 20_000);
      expect(tui.screenText()).toContain("/search <text>|next|prev|clear");
    });
  }, 60_000);

  test("interrupt: Ctrl+C mid-turn cancels a slow streaming turn", async () => {
    server.setScenario({ kind: "slow", chunkDelayMs: 1_000, chunks: 20 });
    try {
      await withTuiCmd(async (tui) => {
        tui.type("Say hi\r");
        // Wait until the slow stream has actually delivered content (the
        // footer shows the model name from boot, so it proves nothing here).
        await tui.waitForText("TUI-MOCKED", 60_000);
        await Bun.sleep(800); // let beginTurn() finish registering the abort controller
        tui.type("\u0003"); // Ctrl+C interrupts the active turn
        await tui.waitForText("Turn cancelled", 30_000);
      });
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 120_000);

  test("exit summary reports session token usage", async () => {
    const tui = await startTui(sandbox, { args: ["tui"] });
    try {
      tui.type("Say hi\r");
      await tui.waitForText("mock/mock-model", 60_000);
      tui.type("/exit\r");
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && tui.exitCode() === null) await Bun.sleep(50);
      expect(tui.exitCode()).toBe(0);
      // The exit summary rides the raw output after the UI stops; poll for
      // it (flush timing varies under load).
      const deadline2 = Date.now() + 15_000;
      let raw = tui.rawTail(4_000);
      while (Date.now() < deadline2 && !/Token usage|total=\d+|session \d+ token/i.test(raw)) {
        await Bun.sleep(200);
        raw = tui.rawTail(4_000);
      }
      expect(raw).toMatch(/Token usage|total=\d+|session \d+ token/i);
    } finally {
      await tui.close();
    }
  }, 120_000);

  test("rewind browser after a completed turn", async () => {
    await withTuiCmd(async (tui) => {
      tui.type("Say hi\r");
      await tui.waitForText(SENTINEL, 90_000);
      // Double-Esc opens the conversation rewind browser.
      tui.type("\u001b");
      await Bun.sleep(300);
      tui.type("\u001b");
      await tui.waitForBuffer("Rewind conversation", 20_000);
      tui.type("\u001b");
      await Bun.sleep(400);
    });
  }, 150_000);
});
