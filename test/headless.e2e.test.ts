// Offline sandbox e2e for the compiled binary: headless flows against the
// local mock model server. No real network, no quota, deterministic.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { createSandbox, runBinary, type Sandbox } from "./helpers/sandbox.ts";
import { startModelServer, type ModelServer } from "./helpers/model-server.ts";

let sandbox: Sandbox;
let server: ModelServer;
const SENTINEL = "MOCKED-RESPONSE-OK";

beforeAll(async () => {
  sandbox = await createSandbox();
  server = await startModelServer({ sentinel: SENTINEL });
  await sandbox.writeProviderFixture({ baseUrl: `${server.url}/v1` });
}, 30_000);

afterAll(async () => {
  await server?.close();
  await sandbox?.dispose();
}, 30_000);

describe("headless offline", () => {
  test("plain -p renders the mock response", async () => {
    const r = await runBinary(sandbox, ["-p", "Say the sentinel"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(SENTINEL);
  }, 60_000);

  test("--json contract: sessionId, response, usage", async () => {
    const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"]);
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.sessionId).toMatch(/^sess_/);
    expect(j.response).toContain(SENTINEL);
    expect(j.usage.inputTokens).toBeGreaterThan(0);
    expect(j.usage.outputTokens).toBeGreaterThan(0);
    expect(typeof j.eventCount).toBe("number");
  }, 60_000);

  test("--output-format stream-json emits parseable JSON lines", async () => {
    const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--output-format", "stream-json"]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  }, 60_000);

  test("model request hits the mock with the configured model and stream", async () => {
    const before = server.requests().length;
    await runBinary(sandbox, ["-p", "Say the sentinel", "--json"]);
    const requests = server.requests().slice(before);
    expect(requests.length).toBeGreaterThan(0);
    const last = requests.at(-1)!;
    expect(last.url).toBe("/v1/chat/completions");
    expect(last.model).toBe("mock-model");
    expect(last.stream).toBe(true);
    expect(last.authPrefix).toContain("Bearer");
  }, 60_000);

  test("rate-limited responses surface a provider business error and retry", async () => {
    server.setScenario({ kind: "rate-limit" });
    try {
      const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"], {
        extraEnv: {
          ZCODE_MODEL_RETRY_MAX_RETRIES: "1",
          ZCODE_MODEL_RETRY_BASE_DELAY_MS: "10",
          ZCODE_MODEL_RETRY_MAX_DELAY_MS: "20",
        },
      });
      expect(r.exitCode).not.toBe(0);
      const combined = r.stdout + r.stderr;
      expect(/1302|Rate limit|rate limit/i.test(combined)).toBe(true);
      expect(server.requests().length).toBeGreaterThan(1);
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 90_000);

  test("unauthorized responses fail with a clear error and do not retry forever", async () => {
    server.setScenario({ kind: "unauthorized" });
    try {
      const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"], {
        extraEnv: { ZCODE_MODEL_RETRY_MAX_RETRIES: "1", ZCODE_MODEL_RETRY_BASE_DELAY_MS: "10", ZCODE_MODEL_RETRY_MAX_DELAY_MS: "20" },
      });
      expect(r.exitCode).not.toBe(0);
      expect(/api key|401|unauthorized|invalid/i.test(r.stdout + r.stderr)).toBe(true);
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 90_000);

  test("server errors (500) fail without hanging", async () => {
    server.setScenario({ kind: "server-error" });
    try {
      const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"], {
        extraEnv: { ZCODE_MODEL_RETRY_MAX_RETRIES: "1", ZCODE_MODEL_RETRY_BASE_DELAY_MS: "10", ZCODE_MODEL_RETRY_MAX_DELAY_MS: "20" },
      });
      expect(r.exitCode).not.toBe(0);
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 90_000);

  test("malformed sse fails without hanging", async () => {
    server.setScenario({ kind: "malformed-sse" });
    try {
      const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"], {
        timeoutMs: 60_000,
        extraEnv: { ZCODE_MODEL_RETRY_MAX_RETRIES: "1", ZCODE_MODEL_RETRY_BASE_DELAY_MS: "10", ZCODE_MODEL_RETRY_MAX_DELAY_MS: "20" },
      });
      expect(r.exitCode).not.toBe(0);
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 90_000);

  test("truncated streams are retried (request count grows)", async () => {
    server.setScenario({ kind: "cut-stream" });
    try {
      const before = server.requests().length;
      const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"], {
        timeoutMs: 90_000,
        extraEnv: { ZCODE_MODEL_RETRY_MAX_RETRIES: "2", ZCODE_MODEL_RETRY_BASE_DELAY_MS: "10", ZCODE_MODEL_RETRY_MAX_DELAY_MS: "20" },
      });
      const attempts = server.requests().length - before;
      expect(attempts).toBeGreaterThanOrEqual(2);
      // Exhausted retries must fail loudly rather than report success.
      expect(r.exitCode).not.toBe(0);
    } finally {
      server.setScenario({ kind: "success" });
    }
  }, 120_000);

  test("session resume works offline", async () => {
    const r1 = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"]);
    const sessionId = JSON.parse(r1.stdout).sessionId as string;
    expect(sessionId).toMatch(/^sess_/);
    const r2 = await runBinary(sandbox, ["--resume", sessionId, "-p", "Say the sentinel again", "--json"]);
    expect(r2.exitCode).toBe(0);
    const j2 = JSON.parse(r2.stdout);
    expect(j2.response).toContain(SENTINEL);
    expect(j2.sessionId).toBe(sessionId);
  }, 90_000);

  test("--attach sends the file content to the model", async () => {
    const marker = "ATTACH-MARKER-XYZZY";
    await Bun.write(join(sandbox.cwd, "attach-me.txt"), `the secret is ${marker}\n`);
    const before = server.requests().length;
    const r = await runBinary(sandbox, ["-p", "Summarize the attachment.", "--attach", join(sandbox.cwd, "attach-me.txt"), "--json"]);
    expect(r.exitCode).toBe(0);
    // The attached content must reach the model inside the request body.
    const body = JSON.stringify(server.requests().slice(before).map((x) => x.body));
    expect(body).toContain(marker);
  }, 60_000);

  test("--mode build/edit/yolo are accepted, plan is rejected", async () => {
    for (const mode of ["build", "edit", "yolo"]) {
      const r = await runBinary(sandbox, ["-p", "Say the sentinel", "--mode", mode, "--json"]);
      expect(`${mode}:${r.exitCode}`).toBe(`${mode}:0`);
    }
    const r = await runBinary(sandbox, ["-p", "hi", "--mode", "plan"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Unsupported --mode value: plan");
  }, 90_000);

  test("-c (continue) works offline", async () => {
    const r1 = await runBinary(sandbox, ["-p", "Say the sentinel", "--json"]);
    expect(r1.exitCode).toBe(0);
    const r2 = await runBinary(sandbox, ["-c", "-p", "Say the sentinel", "--json"]);
    expect(r2.exitCode).toBe(0);
    expect(JSON.parse(r2.stdout).response).toContain(SENTINEL);
  }, 90_000);

  test("doctor reports runtime details", async () => {
    const r = await runBinary(sandbox, ["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("zcode doctor");
    expect(r.stdout).toContain("0.16.5");
  }, 60_000);

  test("unknown flags fail with a clear parser error", async () => {
    const r = await runBinary(sandbox, ["--allowed-tools", "Read", "-p", "hi"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Unknown option");
  }, 30_000);

  test("doctor, skills, commands, plugins run offline", async () => {
    for (const args of [["doctor"], ["skills", "list"], ["commands", "list"], ["plugins", "list"]]) {
      const r = await runBinary(sandbox, args);
      expect([args[0], r.exitCode].join(":")).toBe(`${args[0]}:0`);
    }
  }, 60_000);
});
