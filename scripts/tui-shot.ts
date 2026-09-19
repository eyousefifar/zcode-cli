#!/usr/bin/env bun
// tui-shot: captures real TUI scenarios as PNGs for visual review.
//
// Spawns the compiled binary in a pty (same harness as the e2e tests), drives
// scripted keystrokes, reads the emulated @xterm/headless buffer cell-by-cell,
// serializes it to styled HTML, and screenshots it with headless Chrome.
// Output: artifacts/tui/<scenario>.png (+ .html source, + manifest.json).
//
//   bun scripts/tui-shot.ts                  # all scenarios
//   bun scripts/tui-shot.ts boot-dark turn   # subset by name

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createSandbox, type Sandbox } from "../test/helpers/sandbox.ts";
import { startModelServer, type ModelServer } from "../test/helpers/model-server.ts";
import { startTui, type TuiSession } from "../test/helpers/tui-session.ts";

type Cell = { chars: string; fg: number | "default"; bg: number | "default"; inverse: boolean; bold?: boolean; italic?: boolean; underline?: boolean };

interface Scenario {
  name: string;
  themeScheme: "dark" | "light";
  /** Response the mock model streams for a submitted prompt (its sentinel). */
  response?: string;
  extraEnv?: Record<string, string>;
  steps: Array<{ type?: string; pauseMs?: number; waitBuffer?: string; waitMs?: number }>;
  /** After steps: submit a prompt and wait for the model response to render. */
  submit?: { prompt: string; waitFor: string };
  /**
   * Capture the cell grid at the instant the last wait resolves instead of
   * after a settle — for panels that erase themselves on the next tick.
   */
  transient?: boolean;
  cols?: number;
  rows?: number;
}

const SCENARIOS: Scenario[] = [
  { name: "boot-dark", themeScheme: "dark", steps: [{ pauseMs: 500 }] },
  { name: "boot-light", themeScheme: "light", steps: [{ pauseMs: 500 }] },
  {
    name: "help",
    themeScheme: "dark",
    rows: 60,
    steps: [
      { type: "/help", pauseMs: 400 },
      { type: "\r", pauseMs: 400 },
      { type: "\r", pauseMs: 1200, waitBuffer: "Use /help <command> for details.", waitMs: 15_000 },
    ],
  },
  {
    name: "status-panel",
    themeScheme: "dark",
    rows: 60,
    transient: true,
    steps: [
      { type: "/status", pauseMs: 400 },
      { type: "\r", pauseMs: 400 },
      { type: "\r", pauseMs: 500, waitBuffer: "Detailed session information", waitMs: 15_000 },
    ],
  },
  {
    name: "turn-markdown",
    themeScheme: "dark",
    response: "Here is the plan:\n\n1. **Measure** the render path\n2. Optimize hot loops\n\n```ts\nconst t = performance.now();\n```\n\nTUI-MARKDOWN-SHOT-OK",
    steps: [{ pauseMs: 300 }],
    submit: { prompt: "Show me a plan", waitFor: "TUI-MARKDOWN-SHOT-OK" },
  },
  {
    name: "fullscreen-dark",
    themeScheme: "dark",
    extraEnv: { ZCODE_TUI_MODE: "fullscreen" },
    // Fullscreen paints the composer dock a few ticks after the header.
    steps: [{ pauseMs: 2500 }],
  },
];

const ANSI256_TO_HEX: string[] = (() => {
  const table: string[] = [];
  const base16 = [
    "000000", "800000", "008000", "808000", "000080", "800080", "008080", "c0c0c0",
    "808080", "ff0000", "00ff00", "ffff00", "0000ff", "ff00ff", "00ffff", "ffffff",
  ];
  for (let i = 0; i < 16; i++) table.push(base16[i]);
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) {
    table.push([levels[r], levels[g], levels[b]].map((v) => v.toString(16).padStart(2, "0")).join(""));
  }
  for (let i = 0; i < 24; i++) {
    const v = (8 + i * 10).toString(16).padStart(2, "0");
    table.push(v + v + v);
  }
  return table;
})();

function colorStyle(color: number | "default", fallback: string, isFg: boolean): string {
  if (color === "default") return `${isFg ? "color" : "background-color"}:${fallback}`;
  const hex = color < 256 ? `#${ANSI256_TO_HEX[color]}` : `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
  return `${isFg ? "color" : "background-color"}:${hex}`;
}

function cellsToHtml(grid: Cell[][], dark: boolean): string {
  const bg = dark ? "#1c1c1c" : "#ffffff";
  const fg = dark ? "#d4d4d4" : "#1f1f1f";
  const rowsHtml = grid.map((line) => {
    let html = "";
    let span = "";
    let style = "";
    let count = 0;
    const flush = () => {
      if (!span) return;
      html += count === 1 ? `<span style="${style}">${escapeHtml(span)}</span>`
        : `<span style="${style}" data-n="${count}">${escapeHtml(span)}</span>`;
      span = "";
      count = 0;
    };
    for (const cell of line) {
      const cellStyle = [
        colorStyle(cell.inverse ? cell.bg : cell.fg, fg, true),
        colorStyle(cell.inverse ? cell.fg : cell.bg, bg, false),
        cell.bold ? "font-weight:bold" : "",
        cell.italic ? "font-style:italic" : "",
        cell.underline ? "text-decoration:underline" : "",
      ].filter(Boolean).join(";");
      const text = cell.chars === "" ? " " : cell.chars;
      if (cellStyle === style) {
        span += text;
        count += 1;
      } else {
        flush();
        style = cellStyle;
        span = text;
        count = 1;
      }
    }
    flush();
    return `<div class="row">${html}</div>`;
  });
  // Join with NO separator: .term is white-space:pre, so inter-div newlines
  // would each render as an extra blank line (doubling every row height).
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; }
    body { background: ${bg}; }
    .term {
      display: inline-block; padding: 12px 16px;
      font-family: Menlo, Monaco, "SF Mono", monospace;
      font-size: 14px; line-height: 18px; white-space: pre;
      background: ${bg}; color: ${fg};
      min-width: ${grid[0]?.length ?? 80}ch;
    }
    .row { height: 18px; line-height: 18px; }
  </style></head><body><div class="term">${rowsHtml.join("")}</div></body></html>`;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

async function htmlToPng(htmlPath: string, pngPath: string, cols: number, rows: number): Promise<boolean> {
  let chrome: string | undefined;
  for (const candidate of CHROME_CANDIDATES) {
    if (await Bun.file(candidate).exists()) { chrome = candidate; break; }
  }
  if (!chrome) {
    console.warn("  (no Chrome found — writing HTML only)");
    return false;
  }
  const width = Math.ceil(cols * 8.41) + 32;
  const height = rows * 18 + 56; // + padding and rounding headroom so the last row never clips
  const proc = Bun.spawn([chrome, "--headless", "--disable-gpu", "--hide-scrollbars",
    `--screenshot=${pngPath}`, `--window-size=${width},${height}`, `file://${htmlPath}`],
    { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
  return proc.exitCode === 0 && await Bun.file(pngPath).exists();
}

const outDir = join(import.meta.dir, "..", "artifacts", "tui");
await mkdir(outDir, { recursive: true });

const requested = process.argv.slice(2);
const manifest: Record<string, string> = {};

for (const scenario of SCENARIOS) {
  if (requested.length && !requested.includes(scenario.name)) continue;
  console.log(`scenario: ${scenario.name}`);
  let sandbox: Sandbox | undefined;
  let server: ModelServer | undefined;
  let tui: TuiSession | undefined;
  try {
    sandbox = await createSandbox();
    server = await startModelServer({ sentinel: scenario.response ?? "TUI-SHOT-SENTINEL" });
    await sandbox.installSyntheticCredentials();
    await sandbox.writeProviderFixture({ baseUrl: server.url });
    await sandbox.writeAccountSelection();
    tui = await startTui(sandbox, {
      args: ["tui"],
      cols: scenario.cols ?? 110,
      rows: scenario.rows ?? 32,
      respondQueries: scenario.themeScheme,
      extraEnv: { ...scenario.extraEnv },
    });

    let waitedCells: ReturnType<TuiSession["cellsNow"]> | undefined;
    for (const step of scenario.steps) {
      if (step.type) tui.type(step.type);
      if (step.waitBuffer) {
        await tui.waitForBuffer(step.waitBuffer, step.waitMs ?? 15_000);
        // Snapshot at the instant the wait resolves: some panels (e.g.
        // /status) re-render and close within the next frame tick.
        waitedCells = tui.cellsNow();
      }
      if (step.pauseMs) await Bun.sleep(step.pauseMs);
    }

    if (scenario.submit) {
      tui.type(scenario.submit.prompt);
      await Bun.sleep(400);
      tui.type("\r");
      await tui.waitForBuffer(scenario.submit.waitFor, 45_000);
      waitedCells = tui.cellsNow();
      await Bun.sleep(700);
    }

    await tui.waitForBuffer("", 1).catch(() => {}); // flush pending writes
    await Bun.write(join(outDir, `${scenario.name}.txt`),
      tui.screenText() + "\n\n=== buffer ===\n" + tui.bufferText());
    const snap = scenario.transient && waitedCells ? waitedCells : await tui.cells();
    const cols = snap[0]?.length ?? 110;
    const rows = snap.length;
    const html = cellsToHtml(snap, scenario.themeScheme === "dark");
    const htmlPath = join(outDir, `${scenario.name}.html`);
    const pngPath = join(outDir, `${scenario.name}.png`);
    await Bun.write(htmlPath, html);
    const ok = await htmlToPng(htmlPath, pngPath, cols, rows);
    manifest[scenario.name] = ok ? `${scenario.name}.png` : `${scenario.name}.html`;
    console.log(`  -> ${manifest[scenario.name]}`);
  } catch (error) {
    manifest[scenario.name] = `ERROR: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    console.error(`  FAILED: ${manifest[scenario.name]}`);
  } finally {
    await tui?.close();
    await server?.close();
    await sandbox?.dispose();
  }
}

await Bun.write(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nartifacts in ${outDir}`);
