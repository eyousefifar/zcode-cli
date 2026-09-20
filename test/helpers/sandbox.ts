// Sandbox: a fully isolated environment for running the compiled binary —
// its own HOME, its own data dir, a provider fixture pointing at a local
// mock model server, and a minimal env (no leakage from the parent shell).

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

// The runtime encrypts every credential-store value as
// "enc:v1:" base64url(iv) "." base64url(tag) "." base64url(ciphertext)
// with aes-256-gcm keyed by sha256(ZCODE_CREDENTIAL_SECRET). The sandbox
// mints its own synthetic credentials under a fixed test secret, so no test
// ever touches the developer's real login state (D8/R1.3).
const TEST_CREDENTIAL_SECRET = "zcode-test-credential-secret";

function encryptCredentialValue(plain: string): string {
  const key = createHash("sha256").update(TEST_CREDENTIAL_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return [
    "enc:v1:",
    iv.toString("base64url"),
    ".",
    cipher.getAuthTag().toString("base64url"),
    ".",
    ciphertext.toString("base64url"),
  ].join("");
}

// JWT-shaped token with a far-future expiry. The runtime never verifies the
// signature locally (the mock server ignores auth), but expiry checks parse
// the payload — so exp must be real and in the future.
function syntheticJwt(): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    sub: "sandbox-tester",
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    iat: Math.floor(Date.now() / 1000),
  });
  const signature = Buffer.from("synthetic-signature-not-verified").toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export interface Sandbox {
  home: string;
  dataDir: string;
  cwd: string;
  binary: string;
  env(): Record<string, string>;
  writeProviderFixture(options?: { providerId?: string; modelId?: string; baseUrl?: string; apiKey?: string; apiType?: string; models?: string[] }): Promise<void>;
  installSyntheticCredentials(): Promise<void>;
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
      const base: Record<string, string> = {
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
        // Synthetic credentials were encrypted under the fixed test secret.
        base.ZCODE_CREDENTIAL_SECRET = TEST_CREDENTIAL_SECRET;
      }
      // Propagate the parent's proxy environment: the gate's network control
      // (dead-sink proxy) must reach sandboxed children, which replace the
      // whole environment. Without this, the offline guarantee would not
      // cover the binaries under test (judge round 2, codex #11 / grok caveat).
      for (const key of [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
        "http_proxy", "https_proxy", "all_proxy", "no_proxy",
        "ZCODE_HTTP_PROXY", "ZCODE_HTTPS_PROXY", "ZCODE_NO_PROXY",
      ]) {
        if (process.env[key] !== undefined) base[key] = process.env[key] as string;
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
    async installCredentials() {
      throw new Error(
        "installCredentials() was removed: offline tests must not read the developer's real login state. " +
        "Use installSyntheticCredentials().",
      );
    },
    async installSyntheticCredentials() {
      // A synthetic standalone "zai" coding-plan login, valid enough for the
      // TUI login gate and the mock-model pipeline. Values are fabricated;
      // the encryption scheme is the runtime's own (verified by decrypting
      // through the binary in the e2e suite).
      const record: Record<string, string> = {
        "oauth:active_provider": encryptCredentialValue("zai"),
        "oauth:zai:access_token": encryptCredentialValue("synthetic-access-token"),
        "oauth:zai:refresh_token": encryptCredentialValue("synthetic-refresh-token"),
        "oauth:zai:user_info": encryptCredentialValue(JSON.stringify({
          id: "sandbox-user",
          name: "Sandbox Tester",
          email: "sandbox@example.invalid",
        })),
        zcodejwttoken: encryptCredentialValue(syntheticJwt()),
      };
      // Two readers exist: one rooted at $HOME/.zcode, one at
      // $ZCODE_DATA_BASE_DIR/.zcode (codex finding: they disagree). Write both.
      for (const base of [join(home, ".zcode", "v2"), join(dataDir, ".zcode", "v2")]) {
        await mkdir(base, { recursive: true });
        await writeFile(join(base, "credentials.json"), JSON.stringify(record));
      }
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
