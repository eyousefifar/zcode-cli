# Test results — standalone zcode binary

- **Date**: 2026-09-18 (updated after TUI integration)
- **Binary**: `dist/zcode` (bun 1.4.2, `bun build --compile`), upstream CLI version 0.16.5
- **Host**: macOS 27.0.0, darwin/arm64
- **Auth**: isolated store at `~/.zcode-standalone/.zcode/v2`; recommended access path is the
  coding-plan **API key** (OAuth tokens rotate whenever the desktop app is running, which
  invalidates the CLI's copy within minutes)
- **Model default**: `zai-api-key` provider / `GLM-5.3-Flash`

## Matrix

| Case | Result | Notes |
|---|---|---|
| `--version` | PASS | `0.16.5` |
| `--help` | PASS | |
| `doctor` | PASS | reports `node: v26.3.0` (bun runtime), `sea: no (optional)` |
| `skills list` | PASS | |
| `commands list` | PASS | |
| `plugins list` | PASS | |
| `tui` | PASS* | boots, renders (banner, statusline with model/mode/effort), accepts input, submits. Verified under a scripted pty; response rendering in real terminals pending human verification. The TUI is [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli)'s MIT-licensed `@zcode/tui`. |
| `-p --prepare-storage` | PASS | modifier flag, not a standalone command |
| `-p` plain text | PASS | prints reply to stdout |
| `-p --json` | PASS | JSON with `sessionId`, `usage`, `projection` |
| `-p --output-format json` | PASS | |
| `-p --output-format stream-json` | PASS | |
| `-p --mode plan\|edit\|build\|yolo` | PASS | |
| `-p --verbose` | PASS | |
| `-p --no-color` | PASS | |
| `-p --locale zh-CN` | PASS | (one initial failure was an API rate limit, not the flag) |
| `-p --surface terminal` | PASS | |
| `-p -f` (force) | PASS | |
| `-p --attach <file>` | PASS | file content reaches the model |
| `-p --cwd <dir>` | PASS | |
| `-p --disallowed-tools "Bash,Edit"` | PASS | |
| `--resume <sessionId> -p` | PASS | session continuity verified |
| `-c -p` (continue latest) | PASS | |
| `--target "<goal>"` | PASS (behavior) | starts an autonomous agent run; mutually exclusive with `-p` |

## Verified behaviors & known discrepancies

1. **Help lies about some flags.** `--help` advertises `--allowed-tools`,
   `--max-turns`, `--permission-mode`, `--settings` and
   `--allow-main-worktree-yolo`, but they are **not in the actual argument
   parser** and exit with `Unknown option`. Real flags are listed in
   [OPTIONS.md](OPTIONS.md).
2. **`--target` and `-p/--prompt` are mutually exclusive** (enforced with a
   clear error: "Use either --target <objective> or --prompt ...").
3. **Interactive TUI (experimental).** Bundled from
   [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli)
   (`@zcode/tui`, MIT). Verified: boot, full render, input, model resolution,
   submit without crashes. Not yet verified end-to-end in a real terminal —
   if submit silently does nothing, the TUI build doesn't fully pair with the
   darwin 0.16.5 runtime build; headless mode remains the supported path.
4. **CDN update check is stderr noise.** Occasionally a line like
   `ZCode Built-in missing` or `ZCode Built-in skipped (not-due)` appears on
   stderr — it's the CLI's time-gated check for an updated builtin provider
   config fetched from a CDN. Harmless; stdout (and `--json` output) stay
   clean.
5. **Rate limits surface verbosely.** Z.ai API error 1302 (rate limit) is
   printed as a `ProviderBusinessError` with a source code frame. Back off
   and retry.
6. **`cacheControl breakpoint` warnings.** Long system prompts may trigger
   "Maximum 4 cache breakpoints exceeded" warnings from the AI SDK
   (upstream behavior).
7. **Minimal environments need `USER`.** The runtime keys provider/credential
   state on the unix username; without `USER` in the environment model
   resolution fails with "Select a model before continuing". The shim sets it
   from `os.userInfo()` automatically.
8. **OAuth tokens rotate.** While the desktop app is running it refreshes the
   shared account's OAuth token, which invalidates a CLI-logged-in copy within
   minutes. Use the API-key provider for standalone use (see below).

## Model selection notes

Recommended standalone setup — an API-key provider in
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
    "defaultModelSelection": {
      "providerId": "zai-api-key",
      "modelId": "GLM-5.3-Flash"
    }
  }
}
```

The `zai-api` template supplies the anthropic-compatible base URL and the
`GLM-5.3` / `GLM-5.3-Flash` model definitions. API keys are created at
<https://z.ai/manage-apikey/apikey-list>.

`zcode login` (Z.AI OAuth) also works, but the token is invalidated whenever
the desktop app refreshes its own session, so API-key access is the stable
choice for the standalone binary.
