I'll attack the remediations at HEAD, not the original findings — first load the review skill and assessment doc, then read the actual code those fixes claim to land.This is a remediation-integrity audit at a pinned SHA, not a generic diff review. I’ll verify HEAD, then read the claimed fixes in code.HEAD is `8f2f750`. Next I’ll list the claimed remediations and read the actual CI, credential, egress, and release code.CI and release YAML are in hand. Next I’ll read the tests and vendor decrypt/tool-loop paths that the remediations claim to pin.Vendor grep missed the isolation and credential strings — I’ll search the minified blob for the actual env/settings mapping next.D22’s TUI test may not even hit the mock. I’ll extract vendor strings and read the TUI/session/install paths next.There's a local `dist/zcode`. I’ll run the D22 test itself to see whether the committed assertion is actually green.**NO-SHIP v0.16.6.** Several R1/R2 boxes are checked against documentation and tests that would stay green if the claimed control disappeared. Isolation and eval-replay are real; the rest of the ship-rule surface is not.

Verified at `8f2f750`. Live D22 dump was against `dist/zcode` (78M, 2026-09-20).

---

### 1. P0 — D2 install path is still `curl | chmod`; SHA256SUMS is never consumed
**Name-only.** R1.5 is marked done; the README checksum note is explicitly deferred to unchecked R4.

```32:35:README.md
```bash
curl -fL https://github.com/eyousefifar/zcode-cli/releases/latest/download/zcode-darwin-arm64 -o /usr/local/bin/zcode
chmod +x /usr/local/bin/zcode
```
```

`.github/workflows/release.yml:137-152` writes `SHA256SUMS` onto the GitHub release. Nothing in README, `scripts/`, or CI verifies it at install time. `scripts/` has zero `sha256sum` references. A stranger following the documented install still executes unverified bits. That was the P0.

---

### 2. P1 — SHA256SUMS attests whatever the publish job downloaded, not what the build job executed
**Artifact swap is in the design.** Each matrix job uploads `dist/zcode-${{ matrix.target }}` (`.github/workflows/release.yml:117-123`). The publish job then:

1. `actions/download-artifact` (`.github/workflows/release.yml:131-135`)
2. `sha256sum … > SHA256SUMS` **after** the download (`.github/workflows/release.yml:137-142`)
3. publishes binaries + checksums (`.github/workflows/release.yml:144-152`)

No build-job digest, no `sha256sum -c` before release, no SLSA/cosign. If artifacts are substituted between upload and download (compromised `download-artifact`, runner, or artifact store), the checksum file hashes the substitutes and still looks consistent. Combined with finding 1, checksums are a release-page decoration.

Per-target “execution” is `--version` only (`.github/workflows/release.yml:107-110`). That catches SIGILL (they learned this on Rosetta); it does not prove `-p` or `tui` on linux-arm64/darwin-x64.

---

### 3. P1 — Vendor provenance is a file nobody checks
**Name-only as a control.** `vendor/SHA256SUMS` and `vendor/PROVENANCE.md:38-40` tell a human to run `shasum -a 256 -c`. `scripts/gate.sh` never does. CI never does. A hostile or accidental `vendor/zcode.cjs` bump that leaves `SHA256SUMS` stale is still a green gate. R1.6 records identity; it does not enforce it (O2/O4).

---

### 4. P1 — “Offline CI” is a test-design claim, not a network control
**R1.4 acceptance is unmet.** ASD-ST100 R1.4: gate must pass *with outbound network blocked*; “formal network-denied CI verification rides R1.1.”

`.github/workflows/ci.yml:16-42` is `macos-14` + `bash scripts/gate.sh`. No `egress: block`, no proxy-forced deny, no `unshare`. Runners have a full default route. `RUN_PERF=0` in `scripts/gate.sh:44-47` is real (that part of D8 is fixed). The *offline guarantee* is not.

---

### 5. P1 — Egress allowlist test is fail-open and bypassable
**R2.2 is not a control.** `test/headless.e2e.test.ts:206-247`:

- Recording proxy only sees HTTP that honors `HTTP(S)_PROXY`/`ALL_PROXY` (CONNECT or `Host`).
- Assertion is `undisclosed === []`. **Empty `seen` passes.** The test cannot tell “no egress” from “egress that ignored the proxy.”
- It does **not** require the documented `zcode.z.ai:443` hit. The “empirically caught” refresh is not pinned.
- Scope is one headless `-p`. Not TUI, not `plugins` sync (`cdn-zcode.z.ai`), not login, not `wss://zcode.z.ai/ws`.
- UDP, raw TLS sockets, and any HTTP stack that does not call `getProxyForUrl` are invisible. Vendor *does* contain `proxy-from-env` (`getProxyForUrl` / `HTTP_PROXY` in `vendor/zcode.cjs`); that does not cover those paths.
- Subprocess traffic: eval-replay child inherits env (`src/entry.ts:90-94`) so proxy-honoring child HTTP would show up; anything that ignores env would not.

`docs/EGRESS.md:7-9` admits the residual gap, then R2.2 is still checked as “ENFORCED.” `plugins.enabled: true` remains default (`vendor/cli-settings-default.json:36-37`).

---

### 6. P1 — D22 is a mis-test. The interactive tool loop is in the vendor bundle and it runs
**Disagree with the diagnosis.** I ran the committed D22 case against `dist/zcode` and dumped the mock transcript.

Vendor TUI adapter (`vendor/zcode.cjs:3535`, `wZn`):

- Builds a `permissionBroker` whose `requestPermission` reads closure `x`.
- Installs `x = J.requestPermission` for the duration of `submitPrompt` / `sendInput`.
- Event vocab includes `tool_call_started` / `tool_call_result` / `permission_requested`.

Live follow-up request (TUI, no `tuiEnv()`):

| seq | role | content |
|-----|------|---------|
| 3 | assistant | `tool_calls: Bash echo PERM-TOOL-OK` |
| 4 | **tool** | **`PERM-TOOL-OK`** (`tool_call_id=call_mock_1`) |
| 5 | assistant | `PERM-FOLLOWUP-OK` |

Bash **executed**. The screen showed only the user line and `PERM-FOLLOWUP-OK` — no tool card, no `Allow once`. So: not “runtime drops tool_use”; the fork does not *render* tool activity (and build-mode echo appears auto-allowed, so the permission dialog never appears).

The pinned test is inverted and weak:

```163:175:test/tui.e2e.test.ts
        await tui.waitForText(FOLLOW_UP, 90_000);
        expect(tui.screenText()).not.toContain(TOOL_OUTPUT);
        expect(tui.screenText()).not.toContain("Allow once");
        expect(server.requests().length).toBeGreaterThanOrEqual(2);
```

- `not.toContain(TOOL_OUTPUT)` will fail when rendering is fixed — they documented that as “the loop appeared,” which is backwards.
- Omits `tuiEnv()` that every other TUI test uses (`test/tui.e2e.test.ts:31-36` vs `:166`).
- Cumulative `server.requests().length` is not a per-test delta; prior tests in the file already make it ≥2.
- Cites `ZCODE_TUI_DEBUG_EVENTS` and never sets it.
- Mock `tool-use` returns follow-up on **any** second request (`test/helpers/model-server.ts:112-124, 213-216`) without requiring a `tool` role.

`test/unit/contract.test.ts:49-57` freezes event types **without** `tool_call_*`, which matches “we never looked at tool events” rather than “vendor has none.”

---

### 7. P2 — Synthetic credentials match the vendor cipher; the gate does not pin the decrypt path
**Format is real; the crypto contract is not.** Vendor cipher (`vendor/zcode.cjs:2115`): `enc:v1:` + AES-256-GCM + `sha256(ZCODE_CREDENTIAL_SECRET)` + `iv.tag.ciphertext` base64url. `test/helpers/sandbox.ts:11-31` is a byte-compatible encoder. Keys match (`oauth:zai:access_token`, `zcodejwttoken`, …).

What the gate would **not** notice:

- Headless e2e never calls `installSyntheticCredentials()` (`test/headless.e2e.test.ts:16-20`) — api-key fixture only. Credential crypto can die and tier-3 headless stays green.
- No test round-trips through `createZCodeCredentialCipher.decrypt`. The comment at `sandbox.ts:155-156` (“verified by decrypting through the binary”) has no assertion.
- TUI boot is an *incidental* oracle: a KDF/prefix break that fails the login gate would fail `boots to the ready screen`. A change that still produces “logged in” (presence-only check, decrypt-fail-open, new prefix with fallback) would not.

So: load-bearing for “TUI still looks logged in,” not for “vendor decrypt path is unchanged.”

---

### 8. P2 — Crash-restore is proven for the fork fixture, not the compiled binary
`test/fixtures/crash-tui.ts` calls `runTui()` in-process over `VirtualTerminal`. `test/tui-render/crash-restore.test.ts:12-38` never execs `dist/zcode`. Vendor installs its own `uncaughtException` logger (`vendor/zcode.cjs:3569`, `installCliProcessErrorBoundary`) that writes `[zcode-process-exception]` and does **not** `ui.stop()`. `/login` e2e (`test/tui.e2e.test.ts:102-128`) asserts the command ran and the UI resumed; it does not assert `EXIT_ALT_SCREEN`. The handler in `packages/tui/src/index.ts:854-877` is real; the shipped binary path is unproven.

---

### Actually fixed (not name-only)

- **R1.2 eval-replay:** child re-exec + `EVAL_REPLAY_CHILD` (`src/entry.ts:44-121`). Headless Workflow e2e asserts the helper result in the follow-up body (`test/headless.e2e.test.ts:163-189`). Load-bearing.
- **R2.1 isolation:** vendor `parseEnvConfig` (`vendor/zcode.cjs:2095`) maps `ZCODE_STORAGE_DIR` / `ZCODE_SESSION_DB_PATH` (prefix `ZCODE_` + `SESSION_DB_PATH`). Default `~/…` paths still expand to `$HOME` (`W6`); the wrapper override is required. E2e (`test/headless.e2e.test.ts:195-204`) would fail if the env were ignored. `ZCODE_LOG_DIR` is read directly (`vendor/zcode.cjs` `getDefaultLogDir` fallback `~/.zcode/cli/log`).
- **R1.1 CI exists** on push/PR, bun 1.4.2 and action SHAs pinned. The hole is the offline *claim*, not the workflow’s existence.
- **R1.5 matrix honesty:** darwin-x64 on `macos-13` Intel after Rosetta SIGILL is the correct smoke; the ASD-ST100 bullet still says “Rosetta” (doc stale, code better).

---

## SHIP / NO-SHIP

**NO-SHIP v0.16.6.**

Their own rule was “no tag until R1 is fully checked and R2.1–2.2 are done.” Interpreted as *controls that fail when the claim is false*, R1.4, R1.5 (install+checksum binding), R1.6, and R2.2 are not done. `package.json` is still `"version": "0.16.5"` — a `v0.16.6` tag would also fail `.github/workflows/release.yml:112-115` until bumped.

**Blocks a tag**

1. Documented install is still unverified `curl | chmod` (D2 P0 remainder). Checksums on the release page do not count until the install path verifies them.
2. SHA256SUMS is computed post-download in publish, not over the executed build outputs, and is unused at install.
3. Gate/CI do not verify `vendor/SHA256SUMS`.
4. R1.4 network-denied acceptance is not in `ci.yml`.
5. R2.2 egress test is fail-open (empty capture passes; UDP/raw/non-proxy/TUI/plugin-sync unprobed).
6. D22 as written is a false ship note: tools **do** run in `zcode tui`; the TUI **does not show them**. Pinning `not.toContain(TOOL_OUTPUT)` encodes the rendering bug as the contract. Do not tag a TUI that hides the agent loop, and do not tag under the story “vendor has no interactive tool loop.”

**Does not block** (under their rule, once the list above is closed): remaining R3 T3 scenarios, dual-run golden harness, D9 native addons, D7 npm publish, R4 docs rewrite besides the install checksum paragraph.

**Minimum to reverse this:** checksum-verifying install in README **and** a publish-job `sha256sum -c` against digests emitted by each build job; `shasum -c vendor/SHA256SUMS` in `gate.sh`; a CI step that actually denies non-loopback egress (or fails the gate if the recording proxy sees nothing *and* if anything outside the allowlist appears); replace D22’s inverted screen assertions with a `tool`/`tool_result` body assertion plus a render assertion.
