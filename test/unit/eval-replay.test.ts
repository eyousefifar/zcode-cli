// Helper replay e2e (R1.2/D3): the vendor spawns `node --input-type=module
// --eval <shim> [-- <payload>]` helpers. The workflow shim nulls
// globalThis.process (non-configurable) and replaces Date/Math.random, so
// the entry wrapper replays helpers in a guarded child copy of the binary.
// These tests drive the compiled binary through the replay path directly.
import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const BINARY = join(import.meta.dir, "..", "..", "dist", "zcode");

async function evalModule(code: string, payload?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = payload ? ["--input-type=module", "--eval", code, "--", payload] : ["--input-type=module", "--eval", code];
  const proc = Bun.spawn([BINARY, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

describe("eval replay (guarded child)", () => {
  test("workflow-style shim that nulls globalThis.process still exits 0", async () => {
    const r = await evalModule(`
      Object.defineProperty(globalThis, "process", { configurable: false, value: undefined, writable: false });
      console.log("WORKFLOW-OK");`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("WORKFLOW-OK");
  }, 30_000);

  test("pending timers drain before exit (node --eval semantics)", async () => {
    const r = await evalModule(`setTimeout(() => console.log("TIMER_RAN"), 50); console.log("SCHED");`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("TIMER_RAN");
  }, 30_000);

  test("a throwing module exits 1", async () => {
    const r = await evalModule(`throw new Error("EVAL-BOOM");`);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("EVAL-BOOM");
  }, 30_000);

  test("payload after -- lands in node-style argv", async () => {
    const r = await evalModule(`console.log(JSON.stringify(process.argv));`, "PAYLOAD-MARKER");
    expect(r.exitCode).toBe(0);
    const argv = JSON.parse(r.stdout.trim());
    expect(argv[1]).toBe("[eval]");
    expect(argv.at(-1)).toBe("PAYLOAD-MARKER");
  }, 30_000);

  test("cancellation: a module that ignores SIGTERM is SIGKILLed by the escalation", async () => {
    // The module swallows SIGTERM; the wrapper's supervision must escalate to
    // SIGKILL (process-group) after ~2s instead of hanging forever.
    const proc = Bun.spawn(
      [BINARY, "--input-type=module", "--eval",
        `process.on("SIGTERM", () => {}); setInterval(() => {}, 100); console.log("READY");`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const reader = proc.stdout.getReader();
    let out = "";
    const read = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
        if (out.includes("READY")) break;
      }
    })();
    await read; // the turn is live and ignoring SIGTERM from here on
    const startedAt = Date.now();
    proc.kill("SIGTERM");
    const code = await proc.exited;
    const elapsed = Date.now() - startedAt;
    // Escalation fires at ~2s: the child dies with 137, not by our SIGTERM.
    expect(elapsed).toBeLessThan(10_000);
    expect(code === 137 || code === 0).toBe(true);
  }, 30_000);

  test("stdin reaches the replayed module", async () => {
    const proc = Bun.spawn(
      [BINARY, "--input-type=module", "--eval",
        "const chunks=[]; for await (const c of process.stdin) chunks.push(c); process.stdout.write('GOT:'+chunks.join(''));"],
      { stdout: "pipe", stderr: "pipe", stdin: "pipe" },
    );
    proc.stdin.write('{"expr":1}');
    proc.stdin.end();
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(stdout).toContain('GOT:{"expr":1}');
  }, 30_000);
});
