# Test results — standalone zcode binary

- **Date**: 2026-09-18
- **Binary**: `dist/zcode` (bun 1.4.2, `bun build --compile`), upstream CLI version 0.16.5
- **Host**: macOS 27.0.0, darwin/arm64
- **Auth**: isolated store at `~/.zcode-standalone/.zcode/v2` via `zcode login` (OAuth)
- **Model default**: `account:zai-individual-coding-plan` / `GLM-5.3-Flash`

## Matrix

| Case | Result | Notes |
|---|---|---|
| `--version` | PASS | `0.16.5` |
| `--help` | PASS | |
| `doctor` | PASS | reports `node: v26.3.0` (bun runtime), `sea: no (optional)` |
| `skills list` | PASS | |
| `commands list` | PASS | |
| `plugins list` | PASS | |
| `tui` | N/A | stub error (see limitations) |
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
3. **No interactive TUI.** The `@zcode/tui` package is not shipped with the
   desktop app's CLI bundle, so `zcode tui` / bare `zcode` cannot open the
   full-screen UI anywhere (upstream limitation, not caused by this
   packaging). A stub replaces Node's "Cannot find package" with a clear
   message.
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

## Model selection notes

The standalone CLI resolves the model from
`<data-dir>/.zcode/v2/provider_config.json` → `config.defaultModelSelection`:

```json
{ "providerId": "account:zai-individual-coding-plan", "modelId": "GLM-5.3-Flash" }
```

`zcode login` writes this file (defaulting to `GLM-5.3`). Account-plan
providers additionally require exactly one logged-in account with
`current: true`, which `zcode login` establishes by writing the
`account-provider:<id>:identity` credential key.

The desktop app, by contrast, injects its model adapter directly and does not
use this resolution path — which is why a fresh CLI install needs its own
`zcode login` even when the app is signed in.
