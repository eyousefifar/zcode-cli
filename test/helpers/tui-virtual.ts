// In-process virtual terminal for whole-app TUI tests: implements pi-tui's
// Terminal interface over @xterm/headless (same parser as the pty harness),
// feeds keyboard input straight to the TUI's onInput handler, and ANSWERS
// terminal queries (OSC 11, DSR 996, DA1) so theme detection is deterministic.
// Pairs with the [fork] seam: runTui({ terminal, ... }).

import type { Terminal } from "@earendil-works/pi-tui";
import { TerminalScreen } from "./terminal-screen.ts";

export type QueryScheme = "dark" | "light" | "none";

const OSC11_QUERY = "\x1b]11;?\x07";
const OSC11_QUERY_ST = "\x1b]11;?\x1b\\";
const DSR_996_QUERY = "\x1b[?996n";
const DA1_QUERY = "\x1b[c";

export class VirtualTerminal implements Terminal {
  readonly screen: TerminalScreen;
  /** Verbatim writes (pre-ONLCR) — lets tests assert restore sequences like \x1b[?1049l. */
  readonly rawWrites: string[] = [];
  #onInput?: (data: string) => void;
  #onResize?: () => void;
  #replied = new Set<string>();
  #carry = "";
  #closed = false;

  constructor(
    public scheme: QueryScheme = "dark",
    cols = 110,
    rows = 32,
  ) {
    this.screen = new TerminalScreen(cols, rows);
  }

  get columns(): number {
    return this.screen.snapshot().cols;
  }

  get rows(): number {
    return this.screen.snapshot().rows;
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    if (process.env.ZCODE_VT_DEBUG) console.error("[vt] start() registered");
    this.#onInput = onInput;
    this.#onResize = onResize;
  }

  stop(): void {
    if (process.env.ZCODE_VT_DEBUG) console.error("[vt] stop()");
    this.#onInput = undefined;
    this.#closed = true;
  }

  async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

  write(data: string): void {
    if (this.#closed) return;
    this.rawWrites.push(data);
    // A real pty's termios ONLCR translates LF → CRLF before the emulator sees
    // it; pi-tui relies on that. Replicate it or every line drifts left.
    const translated = data.replace(/\r?\n/g, "\r\n");
    void this.screen.write(translated);
    this.#answerQueries(data);
  }

  /** Simulate keystrokes / pasted input from the user side. */
  type(data: string): void {
    if (this.#closed) return;
    if (process.env.ZCODE_VT_DEBUG) console.error(`[vt] type(${JSON.stringify(data)}) hasInput=${!!this.#onInput}`);
    this.#onInput?.(data);
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows);
    this.#onResize?.();
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\x1b[${lines}B`);
    else if (lines < 0) this.write(`\x1b[${-lines}A`);
  }

  hideCursor(): void { this.write("\x1b[?25l"); }
  showCursor(): void { this.write("\x1b[?25h"); }
  clearLine(): void { this.write("\x1b[2K"); }
  clearFromCursor(): void { this.write("\x1b[J"); }
  clearScreen(): void { this.write("\x1b[2J"); }
  setTitle(title: string): void { this.write(`\x1b]2;${title}\x07`); }
  setProgress(_active: boolean): void {}

  #answerQueries(chunk: string): void {
    if (this.scheme === "none") return;
    const buf = this.#carry + chunk;
    const replyOnce = (key: string, present: boolean, response: string) => {
      if (present && !this.#replied.has(key)) {
        this.#replied.add(key);
        // Deliver asynchronously, like a real terminal's answer on stdin.
        queueMicrotask(() => this.#onInput?.(response));
      }
    };
    const dark = this.scheme === "dark";
    replyOnce("osc11", buf.includes(OSC11_QUERY) || buf.includes(OSC11_QUERY_ST),
      `\x1b]11;rgb:${dark ? "1c1c/1c1c/1c1c" : "ffff/ffff/ffff"}\x1b\\`);
    replyOnce("dsr996", buf.includes(DSR_996_QUERY), dark ? "\x1b[?997;1n" : "\x1b[?997;2n");
    replyOnce("da1", buf.includes(DA1_QUERY), "\x1b[?62;22c");
    this.#carry = buf.slice(-8);
  }

  async dispose(): Promise<void> {
    this.screen.dispose();
  }
}
