// Sandbox: a fully isolated environment for running the compiled binary —
// its own HOME, its own data dir, a provider fixture pointing at a local
// mock model server, and a minimal env (no leakage from the parent shell).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

export interface Sandbox {
  home: string;
  dataDir: string;
  cwd: string;
  binary: string;
  env(): Record<string, string>;
  writeProviderFixture(options?: { providerId?: string; modelId?: string; baseUrl?: string; apiKey?: string; apiType?: string; models?: string[] }): Promise<void>;
  installCredentials(sourcePath?: string): Promise<void>;
  writeAccountSelection(providerId?: string, modelId?: string): Promise<void>;
  dispose(): Promise<void>;
}

const BINARY = process.env.ZCODE_TEST_BINARY ?? join(import.meta.dir, "..", "..", "dist", "zcode");

export async function createSandbox(): Promise<Sandbox> {
  const home = await mkdtemp(join(tmpdir(), "zcode-sandbox-"));
  // Both layers agree on $HOME/.zcode: the runtime defaults its personal
  // provider config there, and the bundled TUI (kingsword09) reads
  // $HOME/.zcode/cli/setting.json + $HOME/.zcode/v2/provider_config.json.
  const dataDir = join(home, ".zcode-data");
  const cwd = join(home, "workspace");
  await mkdir(join(cwd, ".git"), { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const sandbox: Sandbox = {
    home,
    dataDir,
    cwd,
    binary: BINARY,
    credentialsInstalled: false,
    env() {
      const base = {
        HOME: home,
        USER: process.env.USER || "tester",
        LOGNAME: process.env.USER || "tester",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TERM: "xterm-256color",
        LANG: "en_US.UTF-8",
        TMPDIR: join(home, "tmp"),
        ZCODE_DATA_BASE_DIR: dataDir,
        ZCODE_DISABLE_UPDATE_CHECK: "1",
      };
      if (this.credentialsInstalled) {
        // Copied credentials were encrypted under the real machine's
        // derived secret (platform:homedir:username); reproduce it here.
        base.ZCODE_CREDENTIAL_SECRET = `zcode-credential-fallback:${process.platform}:${process.env.HOME}:${process.env.USER || "tester"}`;
      }
      return base;
    },
    async writeProviderFixture(options = {}) {
      // The TUI's login gate only accepts CODING-PLAN access
      // (zhipu-coding-plan-api-key via the zai-api template); a generic
      // api-key provider passes headless but blocks TUI submission.
      const providerId = options.providerId ?? "mock";
      const modelId = options.modelId ?? "mock-model";
      const codingPlan = options.apiType === "anthropic-messages";
      // The runtime's rule schema is strict: absent keys only — explicit
      // nulls (e.g. "templateId": null) fail validation and silently empty
      // the provider registry.
      const rule: Record<string, unknown> = {
        providerId,
        providerName: "Mock provider",
        enabled: true,
        config: {
          group: "standard-personal",
          access: codingPlan
            ? { type: "zhipu-coding-plan-api-key", apiKey: options.apiKey ?? "mock-key", apiKeyManagementUrl: "https://z.ai/manage-apikey/apikey-list" }
            : { type: "api-key", apiKey: options.apiKey ?? "mock-key" },
          api: {
            type: options.apiType ?? "openai-chat-completions",
            baseUrl: options.baseUrl ?? "http://127.0.0.1:1/v1",
          },
          personalModelIds: options.models ?? [modelId],
          visibility: "visible",
        },
      };
      if (codingPlan) {
        rule.templateId = "zai-api";
        (rule.config as Record<string, unknown>).logo = { type: "builtin", key: "zai" };
      }
      const config = {
        schemaVersion: 1,
        config: {
          providerConfigRules: {
            providerRules: [rule],
          },
          modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
          defaultModelSelection: { providerId, modelId },
        },
      };
      // The runtime AND the bundled TUI both resolve the personal provider
      // config from ZCODE_DATA_BASE_DIR (via sharedDataBaseDir).
      const runtimePath = join(dataDir, ".zcode", "v2", "provider_config.json");
      await mkdir(join(runtimePath, ".."), { recursive: true });
      await writeFile(runtimePath, JSON.stringify(config));
    },
    async dispose() {
      await Bun.$`rm -rf ${home}`.quiet();
    },
    async installCredentials(sourcePath = join(process.env.HOME!, ".zcode-standalone", ".zcode", "v2", "credentials.json")) {
      // Copy the machine's own encrypted standalone-login state so the TUI's
      // coding-plan gate passes. Values are AES-GCM encrypted with a
      // machine-derived key and never leave this machine.
      await mkdir(join(home, ".zcode", "v2"), { recursive: true });
      await Bun.write(join(home, ".zcode", "v2", "credentials.json"), await Bun.file(sourcePath).text());
      this.credentialsInstalled = true;
    },
    async writeAccountSelection(providerId = "account:zai-individual-coding-plan", modelId = "GLM-5.3-Flash") {
      const path = join(dataDir, ".zcode", "v2", "provider_config.json");
      const config = JSON.parse(await Bun.file(path).text());
      config.config.defaultModelSelection = { providerId, modelId };
      await writeFile(path, JSON.stringify(config));
    },
  };
  return sandbox;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runBinary(
  sandbox: Sandbox,
  args: string[],
  options: { timeoutMs?: number; stdin?: string; extraEnv?: Record<string, string> } = {},
): Promise<RunResult> {
  const proc = Bun.spawn([sandbox.binary, ...args], {
    cwd: sandbox.cwd,
    env: { ...sandbox.env(), ...(options.extraEnv ?? {}) },
    stdin: options.stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch {}
  }, options.timeoutMs ?? 120_000);
  let stdout = "";
  let stderr = "";
  if (options.stdin) proc.stdin?.write(options.stdin);
  proc.stdin?.end();
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  stdout = out;
  stderr = err;
  clearTimeout(timeout);
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}
