// Contract test (R2.4 / ASD-ST100 D10): freezes the fork↔vendor interface so
// upstream drift fails CI instead of breaking the binary at runtime.
//
// The vendor loads the TUI from node_modules/@zcode/tui/dist/index.js (or via
// import("@zcode/tui") outside SEA) and consumes exactly one export:
// `.runTui`. Our build overlays packages/tui/dist/index.js onto that path.
// These tests pin: (1) the vendor's load path + export usage, (2) our overlay
// actually being in place and byte-identical, (3) the event vocabulary the
// fork's normalizer must understand to render vendor session events.

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const VENDOR = join(ROOT, "vendor", "zcode.cjs");
const FORK_DIST = join(ROOT, "packages", "tui", "dist", "index.js");
const OVERLAY = join(ROOT, "node_modules", "@zcode", "tui", "dist", "index.js");

describe("fork↔vendor contract", () => {
  test("vendor loads the TUI from the overlay path and consumes .runTui", () => {
    const vendor = readFileSync(VENDOR, "utf8");
    // Load path (SEA extraction target) — scripts/build.sh copies our fork
    // build to exactly this path.
    expect(vendor).toContain('node_modules/@zcode/tui/dist/index.js');
    // Non-SEA fallback import.
    expect(vendor).toContain('import("@zcode/tui")');
    // The only consumed export at the call site: `.runTui`.
    expect(vendor).toMatch(/\(await AZn\(\)\)\.runTui/);
  });

  test("fork dist exists, exports runTui, and the overlay is byte-identical", () => {
    expect(existsSync(FORK_DIST)).toBe(true);
    expect(existsSync(OVERLAY)).toBe(true);
    // A stale or missing overlay silently ships old UI code — fail loudly.
    const fork = readFileSync(FORK_DIST);
    const overlay = readFileSync(OVERLAY);
    expect(overlay.equals(fork)).toBe(true);
    // The dist must export runTui (bundle minifies internals, not the export).
    const dist = readFileSync(FORK_DIST, "utf8");
    expect(dist).toContain("runTui");
  });

  test("event vocabulary: normalizer understands the vendor's session event types", async () => {
    const { normalizeEvent } = await import("../../packages/tui/src/events.ts");
    // Frozen as of vendor 0.16.5 — observed live via ZCODE_TUI_DEBUG_EVENTS
    // during pty e2e runs. If the vendor renames/adds event types, update the
    // fork's normalizer AND this list together.
    const vendorEventTypes = [
      "turn_started",
      "turn_complete",
      "model_request",
      "model_complete",
      "model_streaming",
      "model_network_status",
      "session_title_updated",
    ];
    for (const type of vendorEventTypes) {
      const event = normalizeEvent({ type, sessionId: "sess_x", turnId: "t1" });
      // "understands" = not rejected as malformed (it may legitimately map to
      // a passthrough envelope; it must not come back null/throw).
      expect(event).not.toBeNull();
    }
  });
});
