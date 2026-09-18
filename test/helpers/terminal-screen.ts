import { Terminal as HeadlessTerminal } from "@xterm/headless";

export interface TerminalScreenSnapshot {
  buffer: "alternate" | "normal";
  cols: number;
  cursor: {
    x: number;
    y: number;
  };
  rows: number;
  text: string;
}

function linesText(lines: string[]): string {
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

export class TerminalScreen implements Disposable {
  readonly #terminal: HeadlessTerminal;
  #pendingWrite: Promise<void> = Promise.resolve();
  #title = "";

  constructor(cols: number, rows: number, scrollback = 2_000) {
    this.#terminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback
    });
    this.#terminal.onTitleChange((title) => { this.#title = title; });
  }

  write(data: string | Uint8Array): Promise<void> {
    const owned = typeof data === "string" ? data : Uint8Array.from(data);
    this.#pendingWrite = this.#pendingWrite.then(() => new Promise<void>((resolve) => {
      this.#terminal.write(owned, resolve);
    }));
    return this.#pendingWrite;
  }

  async settled(): Promise<void> {
    await this.#pendingWrite;
  }

  title(): string {
    return this.#title;
  }

  screenText(): string {
    const buffer = this.#terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.#terminal.rows; row += 1) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    }
    return linesText(lines);
  }

  bufferText(): string {
    const buffer = this.#terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    return linesText(lines);
  }

  snapshot(): TerminalScreenSnapshot {
    const buffer = this.#terminal.buffer.active;
    return {
      buffer: buffer.type,
      cols: this.#terminal.cols,
      cursor: {
        x: buffer.cursorX,
        y: buffer.cursorY
      },
      rows: this.#terminal.rows,
      text: this.screenText()
    };
  }

  resize(cols: number, rows: number): void {
    this.#terminal.resize(cols, rows);
  }

  /** Cell-level access for color/style assertions (theme determinism etc.). */
  cellAt(col: number, row: number, fullBuffer = false): { chars: string; fg: number | "default"; bg: number | "default"; inverse: boolean; bold: boolean; italic: boolean; underline: boolean } | undefined {
    const buffer = this.#terminal.buffer.active;
    const lineY = fullBuffer ? row : buffer.viewportY + row;
    const cell = buffer.getLine(lineY)?.getCell(col);
    if (!cell) return undefined;
    const color = (value: number, isRGB: boolean): number | "default" => {
      if (value < 0) return "default";
      // xterm packs truecolor as 0xRRGGBB when isRGB() — keep it numeric.
      return isRGB ? value : value;
    };
    return {
      chars: cell.getChars() || " ",
      fg: color(cell.getFgColor(), cell.isFgRGB()),
      bg: color(cell.getBgColor(), cell.isBgRGB()),
      inverse: cell.isInverse(),
      bold: cell.isBold(),
      italic: cell.isItalic(),
      underline: cell.isUnderline(),
    };
  }

  /** Visible-screen row count and total buffer row count. */
  dimensions(): { cols: number; rows: number; bufferRows: number } {
    const buffer = this.#terminal.buffer.active;
    return { cols: this.#terminal.cols, rows: this.#terminal.rows, bufferRows: buffer.length };
  }

  /** First visible-screen location whose cell chars contain `needle`. */
  findCell(needle: string): { col: number; row: number } | undefined {
    const buffer = this.#terminal.buffer.active;
    for (let row = 0; row < this.#terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (!line) continue;
      for (let col = 0; col < this.#terminal.cols; col += 1) {
        const chars = line.getCell(col)?.getChars() ?? "";
        if (chars && needle.includes(chars)) return { col, row };
      }
    }
    return undefined;
  }

  dispose(): void {
    this.#terminal.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
