// Debug probe for the in-process TUI seam (not a test).
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTui } from "../packages/tui/src/index.ts";
import { VirtualTerminal } from "../test/helpers/tui-virtual.ts";

const home = await mkdtemp(join(tmpdir(), "zcode-probe-"));
const dataDir = join(home, "zcode-data");
await mkdir(dataDir, { recursive: true });
process.env.HOME = home;
process.env.USER ??= "tester";
process.env.ZCODE_DATA_BASE_DIR = dataDir;
process.env.ZCODE_DISABLE_UPDATE_CHECK = "1";
delete process.env.ZCODE_TUI_MODE;
process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(dataDir, "provider_config.json");
await writeFile(process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, JSON.stringify({
  schemaVersion: 1,
  config: { defaultModelSelection: { providerId: "account:test-plan", modelId: "test-model" } },
}));

async function poll(screen: VirtualTerminal["screen"], what: string, needle: string, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let seen = false;
  while (Date.now() < deadline) {
    await screen.settled();
    if (screen.screenText().includes(needle)) seen = true;
    if (seen) { console.log(`[poll] ${what}: SEEN`); return true; }
    await Bun.sleep(20);
  }
  console.log(`[poll] ${what}: NEVER SEEN`);
  return false;
}

let turnCount = 0;
const term = new VirtualTerminal("dark");
const tui = runTui({
  terminal: term,
  version: "0.0.0-test",
  workspaceDirectory: home,
  theme: "auto",
  submitPrompt: async (input, options) => {
    turnCount += 1;
    options.onEvent?.({ kind: "text_start", messageId: "m1" });
    options.onEvent?.({ kind: "text_delta", delta: "STUB-TURN-RESPONSE", messageId: "m1" });
    options.onEvent?.({ kind: "text_end", messageId: "m1" });
  },
  subscribeSessionEvents: () => () => {},
  listSkills: async () => ({ skills: [], totalDiscovered: 0 }),
});

await poll(term.screen, "welcome", "Ask a task about this workspace");

term.type("hi stub");
await Bun.sleep(300);
term.type("\r");
await poll(term.screen, "turn response", "STUB-TURN-RESPONSE");
console.log("turnCount:", turnCount);

term.type("/status");
await Bun.sleep(300);
term.type("\r");
await Bun.sleep(300);
term.type("\r");
await poll(term.screen, "status panel", "Detailed session information");

term.type("/exit");
await Bun.sleep(300);
term.type("\r");
await Bun.sleep(300);
term.type("\r");
const exited = await Promise.race([tui.then(() => true), Bun.sleep(6000).then(() => false)]);
console.log("runTui resolved:", exited);
process.exit(exited ? 0 : 1);
