# Troubleshooting

## "Select a model before continuing"

The CLI resolves the default model from
`<data-dir>/.zcode/v2/provider_config.json`. Fix by logging in and/or setting
the selection explicitly:

```bash
zcode login
# then either pick in the file:
jq '.config.defaultModelSelection = {"providerId": "account:zai-individual-coding-plan", "modelId": "GLM-5.3-Flash"}' \
  ~/.zcode-standalone/.zcode/v2/provider_config.json
```

Account-plan providers require **exactly one** logged-in account. If you have
both individual and team plans, only the account marked current is used;
re-run `zcode login` to fix the state.

## "Model creation failed (traceId: ...)"

Run again with `--verbose` for the cause. Common causes:

- **Not logged in** → `zcode login`
- **No `defaultModelSelection`** → see above
- **Rate limit (providerCode 1302)** → wait and retry; the CLI prints
  `ProviderBusinessError ... Rate limit reached` with a code frame.

## "Interactive TUI is not available"

The TUI requires an interactive terminal (a TTY). Under a pipe, a CI runner
or a captured shell it refuses on purpose:

```bash
# headless alternatives:
zcode -p "your prompt"
zcode -p "your prompt" --json
```

Inside a real terminal the `tui` command (or no command) runs the full
interactive UI — see docs/tui/ for its architecture and test coverage.

## "ZCode Built-in missing" / "ZCode Built-in skipped (not-due)" on stderr

The CLI time-gates a CDN check for an updated builtin provider config. These
lines are informational only; stdout and `--json` output are unaffected.

## Search tools not found

The binary auto-uses ripgrep/bfs/ugrep from `/Applications/ZCode.app` when
present. On machines without the app, install them and either rely on `PATH`
or set the env vars explicitly (see [ENV.md](ENV.md)):

```bash
brew install ripgrep ugrep
```

## Credential decryption errors ("key mismatch")

Credentials are AES-256-GCM encrypted with a machine-derived secret (or
`ZCODE_CREDENTIAL_SECRET`). If you copied a credential store from another
machine, re-run `zcode login` in the new machine's data dir.

## Sharing state with the desktop app (not recommended)

The compiled binary isolates state in `~/.zcode-standalone` by default. To
point it at the app's store anyway:

```bash
export ZCODE_DATA_BASE_DIR="$HOME"
```

The two write different credential/account state shapes; prefer separate
logins.
