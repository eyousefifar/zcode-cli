# Network egress — what this distribution talks to, and why

Verified empirically (2026-09-20, build 0.16.5 + fork TUI): a recording proxy
in the offline e2e suite captures every proxy-honoring egress attempt during a
headless run. The test (`test/headless.e2e.test.ts`, "no non-loopback
egress…") enforces that **only the allowlist below is ever contacted** — any
new egress endpoint fails CI until it is disclosed here. Residual gap:
egress that ignores standard proxy envs (raw UDP, pinned sockets) is not
visible to the probe; nothing observed suggests such traffic exists.

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
