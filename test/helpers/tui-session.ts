// TUI pty session: runs the compiled binary inside a real pty (Bun.Terminal),
// feeds its output through an emulated terminal (TerminalScreen over
// @xterm/headless), and offers deadline-bounded assertions on visible screen
// text with failure context (last screen + raw tail) on timeout.

import { TerminalScreen } from "./terminal-screen.ts";
import type { Sandbox } from "./sandbox.ts";

export interface TuiSession {
  screenText(): string;
  waitScreen(what: string, predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  waitForText(needle: string | RegExp, timeoutMs?: number): Promise<string>;
  type(data: string): void;
  rawTail(bytes?: number): string;
  screenHistory(): string[];
  exitCode(): number | null;
  close(): Promise<void>;
}

export async function startTui(
  sandbox: Sandbox,
  options: { args?: string[]; cols?: number; rows?: number; extraEnv?: Record<string, string>; readyPredicate?: (text: string) => boolean } = {},
): Promise<TuiSession> {
  const cols = options.cols ?? 110;
  const rows = options.rows ?? 32;
  const screen = new TerminalScreen(cols, rows);

  let raw = "";
  const decoder = new TextDecoder();
  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data(_terminal, data) {
      raw += decoder.decode(data, { stream: true });
      void screen.write(data);
    },
  });

  const proc = Bun.spawn([sandbox.binary, ...(options.args ?? ["tui"])], {
    cwd: sandbox.cwd,
    env: { ...sandbox.env(), ...(options.extraEnv ?? {}) },
    terminal,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });

  const screenTextNow = () => screen.screenText();

  async function waitScreen(what: string, predicate: (text: string) => boolean, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && proc.exitCode === null) {
      await screen.settled();
      const text = screenTextNow();
      if (predicate(text)) return text;
      await Bun.sleep(25);
    }
    const text = screenTextNow();
    throw new Error(
      `TUI wait timed out (${what}, exit=${proc.exitCode}).\n--- screen ---\n${text}\n--- raw tail ---\n${raw.slice(-2000)}`,
    );
  }

  const readyPredicate = options.readyPredicate ?? ((text: string) => text.includes("Ask a task about this workspace"));
  await waitScreen("TUI ready", readyPredicate, 30_000);

  return {
    screenText: screenTextNow,
    async waitScreen(what, predicate, timeoutMs = 20_000) {
      const deadline = Date.now() + (timeoutMs ?? 20_000);
      while (Date.now() < deadline && proc.exitCode === null) {
        await screen.settled();
        const text = screenTextNow();
        if (predicate(text)) return text;
        await Bun.sleep(25);
      }
      const text = screenTextNow();
      throw new Error(
        `TUI wait timed out (${what}, exit=${proc.exitCode}).\n--- screen ---\n${text}\n--- raw tail ---\n${raw.slice(-2000)}`,
      );
    },
    async waitForText(needle, timeoutMs = 20_000) {
      const pred = typeof needle === "string" ? (t: string) => t.includes(needle) : (t: string) => needle.test(t);
      return this.waitScreen(`text ${typeof needle === "string" ? needle : needle.source}`, pred, timeoutMs);
    },
    type(data) {
      terminal.write(data);
    },
    rawTail(bytes = 2000) {
      return raw.slice(-bytes);
    },
    screenHistory() {
      return screenTextNow().split("\n");
    },
    exitCode() {
      return proc.exitCode;
    },
    async close() {
      try { proc.kill("SIGTERM"); } catch {}
      await proc.exited;
      screen[Symbol.dispose]?.();
    },
  };
}
