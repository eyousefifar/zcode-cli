# Test & verification

Three layers, all bun-only:

| Layer | Command | What it does | Network |
|---|---|---|---|
| Offline sandbox e2e | `bun test test/` | 21 tests: headless + TUI through the real binary against a local mock model server | none |
| Flag matrix | `bash scripts/test.sh` | 27 documented-flag cases against the real API | real (small quota) |
| Perf baseline | `bash scripts/perf.sh` | startup latency, RSS, turn latency, CPU call-tree sample | real |

The release gate runs everything: `bash scripts/gate.sh` (add `RUN_ONLINE=1`
to include the real-API matrix).

## Offline sandbox suite (`bun test test/`)

Mechanism: each test builds a sandbox (temp `HOME`, isolated
`ZCODE_DATA_BASE_DIR`, a personal provider fixture whose `baseUrl` points at a
local `Bun.serve` mock implementing both OpenAI chat-completions and
Anthropic-messages wire protocols), then drives the **compiled binary** —
headless via `Bun.spawn`, TUI via a real pty (`Bun.Terminal`) with
screen-state assertions through an emulated terminal (`@xterm/headless`).

Covered: plain `-p`, `--json` contract, `stream-json`, request journal
(model/stream/auth), rate-limit + retry, 401, 500, malformed SSE, aborted
streams (retry count asserted), `--resume`, `-c`, `--attach` (request body
contains the file), `--mode build/edit/yolo` acceptance + `plan` rejection,
unknown-flag error, `doctor`, `skills/commands/plugins list`; TUI boot,
submit→stream→render (mock sentinel asserted on the emulated screen),
`/status`, `/help`, `/exit` code 0.

## Flag matrix (`scripts/test.sh`)

27 cases against the real API: every parsed flag, all permission modes,
attach, resume/continue, target, verbose/locale/no-color, hidden flags, TUI
launch, doctor/skills/commands/plugins.

## Performance baseline (2026-09-18, darwin/arm64)

- startup (`--version`): **median 0.34 s** (min 0.34, max 0.37), 10 runs
- short `--json` turn: **median 5.6 s** (dominated by model TTFT ≈ 4.5 s)
- CPU call-tree sample saved to `/tmp/zcode-perf/cpu.sample.txt`

## Verified behaviors & known discrepancies

1. **`--mode plan` is rejected** by this runtime build ("Unsupported --mode
   value: plan. Supported modes: build, edit, yolo"). Use `/plan` in the TUI.
2. **`--target` and `-p/--prompt` are mutually exclusive** (clear error).
3. **TUI (experimental).** Bundled from
   [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli). The
   offline sandbox suite drives real turns through it end-to-end. The
   vendor runtime carries their sync patches (session-event bridge) plus our
   defensive optional-chaining fixes — see [../LICENSE-NOTE](../LICENSE-NOTE).
4. **CDN update check is stderr noise** (`ZCode Built-in skipped
   (not-due)`); stdout/`--json` stay clean.
5. **Rate limits surface verbosely** (Z.ai error 1302 →
   `ProviderBusinessError`). Back off and retry.
6. **Minimal environments need `USER`.** Without it model resolution fails
   ("Select a model before continuing"). The shim sets it from
   `os.userInfo()`.
7. **OAuth tokens rotate.** While the desktop app runs it refreshes the
   shared account token, invalidating a CLI login within minutes. Use the
   API-key provider for standalone use (below).

## Model selection (API-key recipe, recommended)

`<data-dir>/.zcode/v2/provider_config.json`:

```json
{
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "zai-api-key",
        "templateId": "zai-api",
        "providerName": "Z.AI Coding Plan (API key)",
        "enabled": true,
        "config": {
          "access": {
            "type": "zhipu-coding-plan-api-key",
            "apiKey": "<your coding-plan api key>",
            "apiKeyManagementUrl": "https://z.ai/manage-apikey/apikey-list"
          },
          "visibility": "visible"
        }
      }]
    },
    "defaultModelSelection": { "providerId": "zai-api-key", "modelId": "GLM-5.3-Flash" }
  }
}
```

The `zai-api` template supplies the anthropic-compatible base URL and the
`GLM-5.3` / `GLM-5.3-Flash` model definitions. Keys: <https://z.ai/manage-apikey/apikey-list>.

Notes:

- The runtime's rule schema is **strict** — absent keys only (`"templateId":
  null` silently empties the provider registry).
- The TUI's login gate requires **coding-plan** access: either this
  API-key recipe or `zcode login` state. A generic `api-key` provider passes
  headless but blocks TUI submission.
- Credentials are AES-256-GCM encrypted with
  `sha256("zcode-credential-fallback:<platform>:<homedir>:<username>")`
  unless `ZCODE_CREDENTIAL_SECRET` is set (the sandbox tests reproduce the
  real secret to copy login state).
- The desktop app injects its own model adapter and ignores this resolution —
  which is why a fresh standalone install needs its own login/API-key setup.
