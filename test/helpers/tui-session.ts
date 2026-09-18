// TUI pty session: runs the compiled binary inside a real pty (Bun.Terminal),
// feeds its output through an emulated terminal (TerminalScreen over
// @xterm/headless), and offers deadline-bounded assertions on visible screen
// text with failure context (last screen + raw tail) on timeout.
//
// The pty master can also ANSWER the child's terminal queries (OSC 11
// background color, DA1, DSR color-scheme) so theme detection is deterministic
// — without responses, pi-tui's probes time out into the COLORFGBG fallback.

import { TerminalScreen } from "./terminal-screen.ts";
import type { Sandbox } from "./sandbox.ts";

export type QueryScheme = "dark" | "light" | "none";

export type Cell = { chars: string; fg: number | "default"; bg: number | "default"; inverse: boolean; bold: boolean; italic: boolean; underline: boolean };
export type CellRow = Cell[];
export type CellGrid = CellRow[];

export interface TuiSession {
  screenText(): string;
  bufferText(): string;
  waitScreen(what: string, predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  waitForText(needle: string | RegExp, timeoutMs?: number): Promise<string>;
  waitForBuffer(needle: string | RegExp, timeoutMs?: number): Promise<string>;
  type(data: string): void;
  resize(cols: number, rows: number): void;
  rawTail(bytes?: number): string;
  screenLines(): string[];
  cells(): Promise<CellGrid>;
  /** Synchronous snapshot for transient moments (panels that close on the next tick). */
  cellsNow(): CellGrid;
  /** Whole scrollback buffer as a cell grid (for scenarios whose content scrolled). */
  fullBufferCells(): Promise<CellGrid>;
  dimensions(): { cols: number; rows: number; bufferRows: number };
  exitCode(): number | null;
  close(): Promise<void>;
}

export interface StartTuiOptions {
  args?: string[];
  cols?: number;
  rows?: number;
  extraEnv?: Record<string, string>;
  readyPredicate?: (text: string) => boolean;
  /** Answer the child's terminal queries; "none" (default) lets them time out. */
  respondQueries?: QueryScheme;
}

// pi-tui emits "\x1b]11;?\x07" (BEL-terminated), "\x1b[?996n", and the combined
// kitty enable + query + DA1 "\x1b[>Nu\x1b[?u\x1b[c". Sequence boundaries may
// split across pty reads, so matching carries a small tail between chunks.
const OSC11_QUERY = "\x1b]11;?\x07";
const OSC11_QUERY_ST = "\x1b]11;?\x1b\\";
const DSR_996_QUERY = "\x1b[?996n";
const DA1_QUERY = "\x1b[c";

function createQueryResponder(scheme: QueryScheme) {
  let carry = "";
  const replied = new Set<string>();
  return function respond(chunk: string, write: (s: string) => void): void {
    if (scheme === "none") return;
    const buf = carry + chunk;
    const replyOnce = (key: string, present: boolean, response: string) => {
      if (present && !replied.has(key)) {
        replied.add(key);
        write(response);
      }
    };
    const dark = scheme === "dark";
    replyOnce("osc11", buf.includes(OSC11_QUERY) || buf.includes(OSC11_QUERY_ST),
      `\x1b]11;rgb:${dark ? "1c1c/1c1c/1c1c" : "ffff/ffff/ffff"}\x1b\\`);
    replyOnce("dsr996", buf.includes(DSR_996_QUERY), dark ? "\x1b[?997;1n" : "\x1b[?997;2n");
    replyOnce("da1", buf.includes(DA1_QUERY), "\x1b[?62;22c");
    carry = buf.slice(-8);
  };
}

export async function startTui(
  sandbox: Sandbox,
  options: StartTuiOptions = {},
): Promise<TuiSession> {
  const cols = options.cols ?? 110;
  const rows = options.rows ?? 32;
  const args = options.args ?? ["tui"];
  const screen = new TerminalScreen(cols, rows);
  const respond = createQueryResponder(options.respondQueries ?? "none");

  let raw = "";
  const decoder = new TextDecoder();
  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data(_terminal, data) {
      const text = decoder.decode(data, { stream: true });
      raw += text;
      respond(text, (reply) => _terminal.write(reply));
      void screen.write(data);
    },
  });

  const proc = Bun.spawn([sandbox.binary, ...args], {
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
    bufferText: () => screen.bufferText(),
    waitScreen,
    async waitForText(needle, timeoutMs = 20_000) {
      const pred = typeof needle === "string" ? (t: string) => t.includes(needle) : (t: string) => needle.test(t);
      return this.waitScreen(`text ${typeof needle === "string" ? needle : needle.source}`, pred, timeoutMs);
    },
    async waitForBuffer(needle, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && proc.exitCode === null) {
        await screen.settled();
        const buffer = screen.bufferText();
        const hit = typeof needle === "string" ? buffer.includes(needle) : needle.test(buffer);
        if (hit) return buffer;
        await Bun.sleep(25);
      }
      throw new Error(
        `TUI buffer wait timed out (${typeof needle === "string" ? needle : needle.source}, exit=${proc.exitCode}).\n--- screen ---\n${screenTextNow()}\n--- raw tail ---\n${raw.slice(-2000)}`,
      );
    },
    type(data) {
      terminal.write(data);
    },
    resize(c, r) {
      terminal.resize(c, r);
      screen.resize(c, r);
    },
    rawTail(bytes = 2000) {
      return raw.slice(-bytes);
    },
    screenLines() {
      return screenTextNow().split("\n");
    },
    async cells() {
      // Await pending pty bytes before reading — otherwise the grid can lag
      // the terminal by a frame (composer/statusline "missing" from PNGs).
      await screen.settled();
      return this.cellsNow();
    },
    cellsNow() {
      const snap = screen.snapshot();
      const grid: CellGrid = [];
      for (let row = 0; row < snap.rows; row += 1) {
        const line: CellRow = [];
        for (let col = 0; col < snap.cols; col += 1) {
          line.push(screen.cellAt(col, row) ?? { chars: " ", fg: "default", bg: "default", inverse: false, bold: false, italic: false, underline: false });
        }
        grid.push(line);
      }
      return grid;
    },
    async fullBufferCells() {
      await screen.settled();
      const { cols, bufferRows } = screen.dimensions();
      const grid: CellGrid = [];
      for (let row = 0; row < bufferRows; row += 1) {
        const line: CellRow = [];
        for (let col = 0; col < cols; col += 1) {
          line.push(screen.cellAt(col, row, true) ?? { chars: " ", fg: "default", bg: "default", inverse: false, bold: false, italic: false, underline: false });
        }
        grid.push(line);
      }
      // Trim trailing fully-empty rows so tall captures don't pad to nothing.
      while (grid.length && grid[grid.length - 1]!.every((c) => c.chars === " ")) grid.pop();
      return grid;
    },
    dimensions() {
      return screen.dimensions();
    },
    exitCode() {
      return proc.exitCode;
    },
    async close() {
      try { proc.kill("SIGTERM"); } catch {}
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && proc.exitCode === null) await Bun.sleep(25);
      if (proc.exitCode === null) {
        try { proc.kill("SIGKILL"); } catch {}
        await proc.exited;
      }
      terminal.close?.();
      screen[Symbol.dispose]?.();
    },
  };
}
