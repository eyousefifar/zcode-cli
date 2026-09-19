// Crash-restore (R1.7 / ASD-ST100 D6): an uncaught exception in a running TUI
// must restore the terminal (leave alt-screen, mouse off, cursor visible)
// before exiting non-zero — never strand the user's shell in a broken render
// mode. Runs the crash fixture as a child process because the failure is
// process-fatal by design.
import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");

describe("tui crash-restore", () => {
  test("uncaught exception restores the terminal and exits 1", async () => {
    const proc = Bun.spawn(["bun", join(REPO, "test", "fixtures", "crash-tui.ts")], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ZCODE_TUI_MODE: "fullscreen" },
    });
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 30_000);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain("CRASH-RESTORE-PROBE");
    // The crash path must have printed through the fork's handler.
    expect(stderr).toContain("fatal uncaughtException");
    // And the terminal must be restored: pi-tui's stop() emits the
    // alt-screen exit and cursor-show sequences while ui.stop() runs (the
    // fixture observes them on its injected terminal's write stream).
    expect(stderr).toContain("RESTORE-ALT-SCREEN-SEEN");
    expect(stderr).toContain("RESTORE-CURSOR-SEEN");
  }, 60_000);
});
