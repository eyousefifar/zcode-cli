// Crash-restore fixture (R1.7/D6): boots the real TUI over the terminal seam
// in fullscreen mode, then throws from a timer to simulate an async crash.
// The fork's crash-restore handlers must route the failure through ui.stop()
// — restoring alt-screen/mouse/cursor state — before exiting 1.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTui } from "../../packages/tui/src/index.ts";
import { VirtualTerminal } from "../helpers/tui-virtual.ts";

process.env.HOME = await mkdtemp(join(tmpdir(), "zcode-crash-"));
process.env.USER ??= "tester";
process.env.ZCODE_DISABLE_UPDATE_CHECK = "1";
delete process.env.ZCODE_DATA_BASE_DIR;
// Fullscreen is the strongest restoration signal: stop() must emit
// EXIT_ALT_SCREEN (\x1b[?1049l).
process.env.ZCODE_TUI_MODE = "fullscreen";

const term = new (class extends VirtualTerminal {
  write(data: string): void {
    // The child's real stdout carries nothing (the injected terminal consumes
    // pi-tui's writes), so prove restoration happened by watching the write
    // stream synchronously: pi-tui's stop() emits EXIT_ALT_SCREEN before
    // terminal.stop(), exactly during ui.stop() in the crash path.
    if (data.includes("\x1b[?1049l")) process.stderr.write("RESTORE-ALT-SCREEN-SEEN\n");
    if (data.includes("\x1b[?25h")) process.stderr.write("RESTORE-CURSOR-SEEN\n");
    super.write(data);
  }
})("dark");
void runTui({
  terminal: term,
  version: "0.0.0-crash",
  workspaceDirectory: process.env.HOME,
  theme: "auto",
  submitPrompt: async () => {},
  subscribeSessionEvents: () => () => {},
  listSkills: async () => ({ skills: [], totalDiscovered: 0 }),
});
await Bun.sleep(2_500); // reach the ready screen
setTimeout(() => {
  throw new Error("CRASH-RESTORE-PROBE");
}, 100);
