# Network egress — what this distribution talks to, and why

## Enforcement model (what is enforced vs. observed)

1. **Denied (enforced):** the gate runs the entire test phase with dead-sink
   proxies (`127.0.0.1:9`) on standard `HTTP(S)_PROXY`/`ALL_PROXY` AND the
   vendor's native `ZCODE_*_PROXY` variables, propagated into every sandboxed
   test child. Any proxy-honoring egress outside `NO_PROXY` fails the suite.
2. **Recorded (allowlist-checked):** the egress e2e also runs the binary under
   a recording proxy and asserts nothing outside the allowlist is contacted.
3. **Not visible (documented residual risk):** traffic that ignores proxy
   environment variables entirely (raw UDP, pinned sockets). Nothing observed
   suggests such traffic exists; the vendor bundles `proxy-from-env`-style
   resolution for its HTTP stacks.
4. **Not canary-pinned:** the startup provider-refresh is time-gated by state
   outside the test sandbox, so the e2e cannot deterministically force it to
   demonstrate interception; the recording proxy's CONNECT handling is kept
   simple and deny-by-default.

Empirically verified 2026-09-20 (build 0.16.5 + fork TUI): a plain headless
run contacts only the allowlisted backend.

## Allowlisted egress

| Endpoint | Purpose | When |
|---|---|---|
| Provider model endpoints | Model traffic. Default templates: `api.z.ai`, `api.chatglm.site`, `bigmodel.cn`, `api.anthropic.com`, `api.openai.com`. Fully overridable via provider config / `ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN`. | On prompts |
| `zcode.z.ai:443` (`/api/v1/...`) | Z.ai coding-plan backend: OAuth token exchange, client feature-configs, plan/billing balance, remote-control websocket (`wss://zcode.z.ai/ws`). **Empirically verified:** the builtin-provider refresh (`/api/v1/client/configs` family) fires on normal startup — a plain headless run contacts it even without an account. It fails gracefully offline. | Login, startup refresh, TUI usage line, remote-control sessions |
| `zcode.chatglm.site` | Alternate/legacy origin for the same backend (and `wss://…/ws`). | Regional fallback |
| `cdn-zcode.z.ai` | Official plugin marketplace (`marketplace.json`) and plugin asset/icon CDN. Only touched when plugin sync runs; `plugins list` is offline-safe (verified in e2e). | Plugin install/sync |

## Present in the bundle, NOT observed firing (telemetry-off verified)

| Endpoint | Evidence |
|---|---|
| `…log.aliyuncs.com/rum/web/v2` (Alibaba ARMS RUM) | Constant defined once; no telemetry reached it during the proxy-monitored offline run. Agent OTLP telemetry additionally requires an explicitly configured OTLP endpoint. |
| `studio.zcode-ai.com:12345` | Desktop "intranet machine" deps server; default of `INTRANET_MACHINE_HOST`, used in desktop/intranet flows. Not contacted by CLI runs. |
| `registry.npmjs.org` update check | Disabled by default in this distribution (`ZCODE_DISABLE_UPDATE_CHECK=1` is shim-set; the fork updater is additionally version-gated). |

## Defaults this distribution sets

- `ZCODE_DISABLE_UPDATE_CHECK=1` — no npm update probes.
- Plugin CDN is pinned upstream (`cdn-zcode.z.ai`); plugin sync only runs when
  you install/sync plugins. We do not add egress beyond upstream's.
- Loopback is always excluded via `NO_PROXY` in tests; nothing else is
  allowlisted.

## Disclosure rule

New endpoints require: (1) a row here, (2) a matching entry in the egress-test
allowlist with a comment, (3) the reason it cannot be opt-in. Undisclosed
egress = release blocker (ASD-ST100 D11/R2.2).
