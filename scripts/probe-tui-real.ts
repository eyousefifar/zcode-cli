// Probe the real binary's /help and /status panel text (not a test).
import { createSandbox } from "../test/helpers/sandbox.ts";
import { startModelServer } from "../test/helpers/model-server.ts";
import { startTui } from "../test/helpers/tui-session.ts";

const sandbox = await createSandbox();
const server = await startModelServer({ sentinel: "X" });
await sandbox.installCredentials();
await sandbox.writeProviderFixture({ baseUrl: server.url });
await sandbox.writeAccountSelection();

const tui = await startTui(sandbox, { args: ["tui"] });
console.log("=== boot ok ===");

tui.type("/help");
await Bun.sleep(400);
tui.type("\r");
await Bun.sleep(400);
tui.type("\r");
await Bun.sleep(2500);
console.log("=== /help screen ===");
console.log(tui.screenText());

tui.type("\u001b");
await Bun.sleep(600);
tui.type("/status");
await Bun.sleep(400);
tui.type("\r");
await Bun.sleep(400);
tui.type("\r");
await Bun.sleep(2500);
console.log("=== /status screen ===");
console.log(tui.screenText());

await tui.close();
await server.close();
await sandbox.dispose();
