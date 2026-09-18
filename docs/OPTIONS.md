# CLI options reference (zcode 0.16.5)

Verified against the actual argument parser embedded in `vendor/zcode.cjs`
(this is the source of truth — the built-in `--help` text has some drift, see
"Advertised but not parsed" below).

## Commands

| Command | Description |
|---|---|
| *(none)* / `tui` | Full-screen TUI (experimental; bundled from kingsword09/zcode-cli — see README). |
| `login` | Sign in with Z.AI OAuth. `--no-browser` prints the URL instead of opening a browser. |
| `logout` | Remove login credentials from the data dir. |
| `doctor` | Inspect runtime/packaging assumptions. |
| `plugins` | Plugin management (`plugins list`). |
| `skills` | Skill management (`skills list`). |
| `commands` | Custom slash-command management (`commands list`). |
| `app-server` | Run the ZCode Protocol stdio app server. |

## Headless options

| Option | Value | Description |
|---|---|---|
| `-p`, `--prompt <text>` | string | Run a single prompt headlessly and exit. Default permission mode: `yolo`. |
| `--output-format <fmt>` | `text` \| `json` \| `stream-json` | Output format. `json` emits one object with `sessionId`, `response`, `usage`; `stream-json` streams events. |
| `--json` | boolean | Equivalent to `--output-format json`. |
| `--cwd <path>` | string | Working directory for the run. |
| `--attach <path>` | string, repeatable | Attach local files to the prompt. |
| `--resume <sessionId>` | string | Resume a persisted session (`sess_...`). |
| `-c`, `--continue` | boolean | Continue the latest session for the current directory. |
| `--target <text>` | string | Set/achieve a session goal as an autonomous run. **Mutually exclusive with `--prompt`.** |
| `--target-replace` | boolean | Replace any existing session goal when using `--target`. |
| `--mode <mode>` | `build` \| `edit` \| `yolo` | Permission mode. `plan` is **rejected** by this runtime build (use `/plan` inside the TUI). |
| `--verbose` | boolean | Extra diagnostic detail. |
| `--no-color` | boolean | Disable ANSI colors. |
| `--locale <locale>` | string | UI locale: `en-US`, `zh-CN`, `auto`. |
| `--no-browser` | boolean | `login` only: print the OAuth URL. |
| `-f`, `--force` | boolean | Force operation (bypasses some guards). |
| `--force-mcs` | boolean | Force mid-conversation system projection for Anthropic providers. |
| `--surface <surface>` | `terminal` \| `desktop` | Presentation surface for headless runs. |
| `--browser-use <mode>` | `headless` | Browser Use backend (requires playwright-core at runtime). |
| `--browser-executable <path>` | string | Chrome/Chromium executable for headless Browser Use. |
| `--prepare-storage` | boolean | Modifier: initialize storage, then proceed with the command. |
| `--stdio` | boolean | stdio transport (app-server). |
| `-v`, `--version` | boolean | Print version. |
| `-h`, `--help` | boolean | Print help. |

`--disallowedTools <tools...>` / `--disallowed-tools <tools...>` is parsed
before the main parser (comma- or space-separated tool denylist, e.g.
`"Bash(git *) Edit"`).

## Not parsed by the argument parser (upstream drift)

`--allowed-tools`, `--max-turns`, `--permission-mode`, `--settings` and
`--model` are not accepted (model selection is configured via
`defaultModelSelection` — see [TESTING.md](TESTING.md)).

## Exit codes

- `0` success
- `1` error (unknown option, provider/auth errors, rate limits, stubs)
