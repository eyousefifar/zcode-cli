// Tier 1: pure-logic tests for the fork's TUI modules (opencode-style, no
// renderer, no terminal). These are the fastest regression tripwires.

import { describe, test, expect } from "bun:test";
import { normalizeEvent, isModelCancellationEvent, modelLabel, responseText } from "../../packages/tui/src/events.ts";
import { StatusLine } from "../../packages/tui/src/status-line.ts";
import { createTheme } from "../../packages/tui/src/theme.ts";
import { isPlainMarkdownBlock, splitMarkdownSegments } from "../../packages/tui/src/rich-markdown.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

describe("events.normalizeEvent", () => {
  test("passes through a flat event", () => {
    const event = normalizeEvent({ type: "turn_started", turnId: "t1" });
    expect(event?.type).toBe("turn_started");
    expect(event?.turnId).toBe("t1");
  });

  test("unwraps payload/event nesting", () => {
    const event = normalizeEvent({
      payload: { event: { kind: "text_delta", delta: "hi", messageId: "m1" } },
    });
    expect(event?.kind).toBe("text_delta");
    expect(event?.delta).toBe("hi");
    expect(event?.messageId).toBe("m1");
  });

  test("unwraps params.payload nesting and keeps envelope type", () => {
    const event = normalizeEvent({
      type: "session.event",
      params: { payload: { event: { kind: "text_delta", delta: "x" } } },
    });
    expect(event?.delta).toBe("x");
  });

  test("maps snake-case tool lifecycle types onto kinds", () => {
    expect(normalizeEvent({ type: "tool_call_scheduled", toolCallId: "c1" })?.kind).toBe("scheduled");
    expect(normalizeEvent({ type: "tool_call_started", toolCallId: "c1" })?.kind).toBe("started");
    expect(normalizeEvent({ type: "tool_call_result", toolCallId: "c1" })?.kind).toBe("result");
    expect(normalizeEvent({ type: "tool_call_error", toolCallId: "c1" })?.kind).toBe("error");
  });

  test("accepts snake_case id aliases", () => {
    const event = normalizeEvent({ kind: "text_delta", messageID: "m9", sessionID: "s9", turnID: "t9" });
    expect(event?.messageId).toBe("m9");
    expect(event?.sessionId).toBe("s9");
    expect(event?.turnId).toBe("t9");
  });

  test("keeps model network event types even when nested", () => {
    const event = normalizeEvent({
      payload: { event: { type: "model_retry_scheduled", attempt: 2, maxAttempts: 5, delayMs: 1200 } },
    });
    expect(event?.type).toBe("model_retry_scheduled");
    expect(event?.attempt).toBe(2);
  });

  test("returns null for non-records", () => {
    expect(normalizeEvent(null)).toBeNull();
    expect(normalizeEvent("nope")).toBeNull();
    expect(normalizeEvent([1, 2])).toBeNull();
  });

  test("detects cancellation events", () => {
    expect(isModelCancellationEvent(normalizeEvent({ type: "model_request_failed", reason: "Cancelled" })!)).toBe(true);
    expect(isModelCancellationEvent(normalizeEvent({ type: "model_request_failed", errorCode: "MODEL_REQUEST_CANCELLED" })!)).toBe(true);
    expect(isModelCancellationEvent(normalizeEvent({ type: "model_request_failed", errorCode: "rate_limit" })!)).toBe(false);
  });

  test("modelLabel composes provider/model", () => {
    expect(modelLabel({ providerId: "zai", modelId: "GLM-5.3-Flash" })).toBe("zai/GLM-5.3-Flash");
    expect(modelLabel("explicit")).toBe("explicit");
    expect(modelLabel(undefined)).toBe("default");
  });

  test("responseText extracts string responses", () => {
    expect(responseText({ response: "hello" })).toBe("hello");
    expect(responseText({ message: "msg" })).toBe("msg");
    expect(responseText({})).toBeUndefined();
  });
});

describe("status-line degradation", () => {
  const fields = [
    { text: "model-a", priority: 10 },
    { text: "mode-b", priority: 20 },
    { text: "effort-c", priority: 30 },
    { text: "ctx 90% left", priority: 40 },
    { text: "must-keep", priority: 90, required: true },
  ];

  test("renders everything at generous width", () => {
    const line = new StatusLine();
    line.setFields(fields);
    const [out] = line.render(200);
    expect(visibleWidth(out.trim())).toBeLessThanOrEqual(199);
    for (const f of fields) expect(out).toContain(f.text);
  });

  test("drops lowest-priority fields first at narrow width", () => {
    const line = new StatusLine();
    line.setFields(fields);
    const [out] = line.render(30);
    expect(out).toContain("must-keep");
    // Something must have been dropped to fit.
    expect(out).not.toContain("effort-c");
  });

  test("prefers compactText when the full line overflows", () => {
    const line = new StatusLine();
    line.setFields([
      { text: "very-long-model-name-here", compactText: "vlm", priority: 10 },
    ]);
    const [out] = line.render(10);
    expect(out).toContain("vlm");
  });

  test("never emits a line wider than the terminal", () => {
    const line = new StatusLine();
    line.setFields(fields);
    for (const width of [5, 12, 25, 40, 80, 110]) {
      const [out] = line.render(width);
      expect(visibleWidth(out)).toBeLessThanOrEqual(Math.max(0, width - 1) + 1);
    }
  });
});

describe("theme palettes", () => {
  test("dark and light palettes both construct with colors enabled", () => {
    const dark = createTheme(true, "dark");
    const light = createTheme(true, "light");
    expect(dark).toBeTruthy();
    expect(light).toBeTruthy();
  });

  test("palettes expose the documented surface as colorizer functions", () => {
    const theme = createTheme(true, "dark");
    for (const key of ["accent", "success", "warning", "error", "muted", "diffAddedLine", "diffRemovedLine", "searchMatch"]) {
      expect((theme as unknown as Record<string, unknown>)[key]).toBeFunction();
    }
    expect(typeof theme.setColorScheme).toBe("function");
  });
});

describe("markdown segmentation", () => {
  test("plain text is detected as plain", () => {
    expect(isPlainMarkdownBlock("just a sentence")).toBe(true);
  });

  test("markdown constructs are not plain", () => {
    expect(isPlainMarkdownBlock("# heading")).toBe(false);
    expect(isPlainMarkdownBlock("a ```code``` b")).toBe(false);
  });

  test("splitMarkdownSegments keeps prose and mermaid fences apart", () => {
    const segments = splitMarkdownSegments("prose words\n```ts\nconst a = 1;\n```\ntail words");
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0]?.kind).toBe("markdown");
    const mermaid = splitMarkdownSegments("before\n```mermaid\ngraph TD; A-->B;\n```\nafter");
    expect(mermaid.some((s) => s.kind === "mermaid")).toBe(true);
  });
});
