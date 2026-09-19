// Debug: offline TUI submit with real login state + endpoint redirect.
import { createSandbox } from "./helpers/sandbox.ts";
import { startModelServer } from "./helpers/model-server.ts";
import { startTui } from "./helpers/tui-session.ts";

const sandbox = await createSandbox();
const server = await startModelServer({ sentinel: "TUI-DEBUG-SENTINEL" });
await sandbox.installSyntheticCredentials();
await sandbox.writeProviderFixture({ baseUrl: `${server.url}` });
await sandbox.writeAccountSelection();

const env = {
  ...sandbox.env(),
  ZAI_BUSINESS_BASE_URL: server.url,
  ZCODE_BASE_URL: server.url,
};
console.log("env base:", env.ZAI_BUSINESS_BASE_URL);

const tui = await startTui(sandbox, ["tui"], { extraEnv: env });
await Bun.sleep(2000);
console.log("=== SCREEN ===");
console.log(tui.screenText().slice(0, 900));
tui.type("Say hi\r");
await Bun.sleep(6000);
console.log("=== SCREEN AFTER SUBMIT ===");
const t = tui.screenText(); console.log("SENTINEL ON SCREEN:", t.includes("TUI-DEBUG-SENTINEL")); console.log(t.slice(-800));
console.log("=== REQUESTS ===");
console.log(JSON.stringify(server.requests().map(r => ({ url: r.url, model: r.model, stream: r.stream })), null, 1));
await tui.close();
await server.close();
await sandbox.dispose();
process.exit(0);
