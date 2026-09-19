# Environment variables

Everything the standalone build sets up for you is marked **[shim]** — those
are applied by `src/entry.ts` / `src/bin.js` only when you haven't set the
variable yourself.

## Data & config locations

| Variable | Meaning |
|---|---|
| `ZCODE_DATA_BASE_DIR` **[shim]** | Base dir for all CLI state. The shim defaults it to `$HOME/.zcode-standalone`, so state lives in `~/.zcode-standalone/.zcode/v2/` — fully isolated from the desktop app's `~/.zcode/v2/`. Set it to `$HOME` if you want to share the app's store. |
| `ZCODE_STORAGE_DIR` **[shim]** | Runtime storage root (`storage.dir`). The shim defaults it to `<data-dir>/.zcode` so session state is isolated (see below). |
| `ZCODE_SESSION_DB_PATH` **[shim]** | Session database file. The shim defaults it to `<data-dir>/.zcode/cli/db/db.sqlite` (upstream hardwires `$HOME/.zcode/cli/db/db.sqlite`, which collided with the desktop app). |
| `ZCODE_LOG_DIR` **[shim]** | Runtime log directory. The shim defaults it to `<data-dir>/.zcode/cli/log`. |
| `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` | Path of the personal provider config (default `<data-dir>/.zcode/v2/provider_config.json`). Holds `config.defaultModelSelection` and personal provider rules. |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` **[shim]** | Builtin provider registry. The shim points it at a copy of the app's config embedded in the binary, so no app install is required. |
| `ZCODE_CREDENTIAL_SECRET` | Override the credential-encryption secret. Default is a machine-derived fallback string (`zcode-credential-fallback:<platform>:<homedir>:<username>` through SHA-256), so credentials are portable across users on a machine only via this variable. |

### Isolation contract (what moves, what stays)

Under the default `$HOME/.zcode-standalone` data dir, all **mutable session
state** is isolated from the desktop app: credentials and provider config
(`v2/`), the session database, runtime logs, and the storage root.
The wrapper verifies the data dir is writable before startup and fails with a
clear error otherwise.

**Documented exceptions that stay under `$HOME/.zcode`:**
- `~/.zcode/cli/setting.json` — the CLI settings mirror. The vendor's settings
  loader hardcodes this location and sharing it with the desktop app is the
  interop design (theme/locale/profile settings are non-secret).
- `~/.zcode/cli/rollout|debug|model-io-*` — vendor debug/rollout artifacts are
  homedir-hardcoded in the bundle.

## Search & tool binaries

The bundle runs these with the env var value first, falling back to the bare
command on `PATH`:

| Variable | Binary | Bundled with the desktop app at |
|---|---|---|
| `ZCODE_RG_BINARY` **[shim]** | ripgrep | `Resources/tools/ripgrep/rg` |
| `ZCODE_BFS_BINARY` **[shim]** | bfs (breadth-first find) | `Resources/tools/bfs/bfs` |
| `ZCODE_UGREP_BINARY` **[shim]** | ugrep | `Resources/tools/ugrep/ugrep` |
| `ZCODE_GIT_BINARY` | git | — (falls back to `git`) |

The **[shim]** variables are auto-set to the app's bundled binaries when
`/Applications/ZCode.app` exists; otherwise install `ripgrep`/`ugrep` via your
package manager.

## Model & networking

| Variable | Meaning |
|---|---|
| `ZCODE_MODEL_RETRY_BASE_DELAY_MS`, `ZCODE_MODEL_RETRY_MAX_DELAY_MS`, `ZCODE_MODEL_RETRY_MAX_RETRIES`, `ZCODE_MODEL_RETRY_BACKOFF_FACTOR` | Retry/backoff tuning for model requests. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | Standard proxy support (plus `ZCODE_HTTP_PROXY`, `ZCODE_NO_PROXY` variants). |
| `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` | Custom CA bundles. |
| `ZCODE_ENDPOINT_ORIGIN`, `ZCODE_BASE_URL` | Endpoint overrides (defaults to the production Z.ai endpoints). |

## Telemetry & debugging

| Variable | Meaning |
|---|---|
| `ZCODE_TELEMETRY_*` | Telemetry control (see `strings` in the bundle for the full set). |
| `ZCODE_MODEL_TELEMETRY_ENABLED` | Model request telemetry. |
| `ZCODE_DEBUG` | Debug output. |
| `ZCODE_SESSION_ID`, `ZCODE_PROJECT_DIR` | Session/project overrides. |

## OAuth login

`zcode login` performs a Z.AI OAuth device-style flow (client
`client_P8X5CMWmlaRO9gyO-KSqtg`, hosted callback at `zcode.z.ai`). It writes
`oauth:zai:*`, `account-provider:*:identity` keys into
`<data-dir>/.zcode/v2/credentials.json` (AES-256-GCM encrypted with the
derived secret).
