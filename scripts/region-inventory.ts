#!/usr/bin/env bun
/** Maps the //#region markers of vendor/zcode-tui-index.js into a structured inventory. */
import { writeFileSync } from "node:fs";

const src = await Bun.file(new URL("../vendor/zcode-tui-index.js", import.meta.url)).text();
const lines = src.split("\n");

type Region = { name: string; start: number; end: number; lines: number };
const stack: { name: string; start: number }[] = [];
const regions: Region[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const open = line.match(/^\s*\/\/#region (.+?)\s*$/);
  if (open) {
    stack.push({ name: open[1], start: i + 1 });
    continue;
  }
  if (/^\s*\/\/#endregion/.test(line)) {
    const top = stack.pop();
    if (top) regions.push({ name: top.name, start: top.start, end: i, lines: i - top.start + 1 });
  }
}

// Nesting: report top-level regions (those whose start isn't inside a previously closed span we track via stack depth).
// Simpler: rebuild with depth tracking.
const depthAt = new Map<number, number>();
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*\/\/#region /.test(lines[i])) depth++;
  depthAt.set(i + 1, depth);
  if (/^\s*\/\/#endregion/.test(lines[i])) depth = Math.max(0, depth - 1);
}

const out = regions
  .map((r) => ({ ...r, depth: depthAt.get(r.start) ?? 0 }))
  .sort((a, b) => a.start - b.start);

const report = out
  .map((r) => `${"  ".repeat(Math.max(0, r.depth - 1))}${r.name}  L${r.start}-${r.end}  (${r.lines} lines)`)
  .join("\n");

const summary = {
  totalRegions: out.length,
  totalLines: lines.length,
  byTopLevel: Object.entries(
    Object.groupBy(out.filter((r) => r.depth === 1), (r) => r.name.split("/").slice(0, 2).join("/")),
  ).map(([k, v]) => ({ group: k, regions: v!.length, lines: v!.reduce((s, r) => s + r.lines, 0) })),
};

console.log(report);
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
writeFileSync(new URL("../artifacts/tui-region-inventory.txt", import.meta.url), report + "\n");
writeFileSync(new URL("../artifacts/tui-regions.json", import.meta.url), JSON.stringify(out, null, 2));
