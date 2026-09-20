I'll re-audit HEAD in code, not from the doc: confirm the commit, then verify each of the six blockers and the smaller fixes with file:line evidence.HEAD is `c81bca4`. Next I’ll read the release, gate, install, and test files that should close the six blockers.Round-1 review skill is for PR diffs, not this re-audit. I’ll read the claimed remediations in source next.Install and release YAML look mostly aligned; next I’ll verify hashes, egress, and the D22/D23 tests in source.The Allow-test “tool-role” claim looks weak (marker is already in tool-call args). I’ll read spawn/env merging, eval-replay, and the other smaller fixes next.Verified at `c81bca4c6bfc349379c66655dae86411bb174968`. Adversarial re-audit of the six round-1 blockers **in code**, not from the assessment doc.

---

## Blocker 1 — Install path consumes SHA256SUMS

**CLOSED**

README now downloads the four release binaries **and** `SHA256SUMS`, then verifies before copy/chmod:

```33:41:README.md
V=$(curl -fsSL https://api.github.com/repos/eyousefifar/zcode-cli/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
for f in zcode-darwin-arm64 zcode-darwin-x64 zcode-linux-x64 zcode-linux-arm64 SHA256SUMS; do
  curl -fLO "https://github.com/eyousefifar/zcode-cli/releases/download/v${V}/${f}"
done
# macOS: `shasum -a 256 -c`; Linux: `sha256sum -c`
shasum -a 256 -c SHA256SUMS || exit 1
sudo cp zcode-darwin-arm64 /usr/local/bin/zcode   # pick your platform's file
```

Artifact names match the publish list (`release.yml:162-167`) and `build.ts` outfiles (`zcode-darwin-arm64`, `zcode-darwin-x64`, `zcode-linux-x64`, `zcode-linux-arm64`). Tag substitution is consistent with `on.push.tags: ["v*"]`: sed strips the leading `v`, URL puts it back. Empty `V` fail-closes via `curl -f`. `shasum -c` without `--ignore-missing` is why the loop fetches all four — that is correct, not accidental.

**Residuals (not the P0):** copy-paste still installs `zcode-darwin-arm64`; Linux is told to use `sha256sum` but the command is `shasum`. Checksums are GitHub-HTTPS trust, not signed.

---

## Blocker 2 — SHA256SUMS bound to executed bytes

**CLOSED** (one scoping residual)

Build job hashes **after** smoke execution, then uploads binary + digest together:

```117:133:.github/workflows/release.yml
      - name: Digest the executed binary
        run: |
          cd dist
          shasum -a 256 zcode-${{ matrix.target }} > "zcode-${{ matrix.target }}.sha256"
      - name: Upload target artifact
        ...
          path: |
            dist/zcode-${{ matrix.target }}
            dist/zcode-${{ matrix.target }}.sha256
```

linux-arm64 smoke is `docker … -v …/dist:/dist:ro` (`release.yml:108-109`) — the hashed file is the same bytes that ran. Publish **always** runs (`release.yml:139-140`); only softprops is tag-gated (`release.yml:159`). Verify-then-manifest:

```148:167:.github/workflows/release.yml
          shasum -a 256 -c zcode-darwin-arm64.sha256 zcode-darwin-x64.sha256 zcode-linux-x64.sha256 zcode-linux-arm64.sha256
          sha256sum zcode-darwin-arm64 zcode-darwin-x64 zcode-linux-x64 zcode-linux-arm64 > SHA256SUMS
        ...
          files: |
            dist/zcode-darwin-arm64
            ...
            dist/SHA256SUMS
```

Same workspace files are verified, re-hashed, and uploaded. `chmod +x` does not change content. Substituted artifacts fail `shasum -c`.

**Residual:** `permissions: contents: write` is still workflow-wide (`release.yml:23-24`). Codex’s fix was “restrict to publishing.” Gate and build still get release-write. Hygiene, not a digest-binding hole.

---

## Blocker 3 — `vendor/SHA256SUMS` enforced in the gate

**CLOSED**

```16:17:scripts/gate.sh
step "vendor integrity (vendor/SHA256SUMS must match the checked-in bundle)"
( cd vendor && shasum -a 256 -c SHA256SUMS ) || FAIL=1
```

CI runs `bash scripts/gate.sh` (`ci.yml:42`). Current tree matches (all six files `OK`). A mutated `zcode.cjs` digest fails `shasum -c` (`zcode.cjs: FAILED` reproduced against a temp checksum file). Gate uses `FAIL=1` + `exit $FAIL` (`gate.sh:83-84`), so a stale hash fails the job.

**Residual vs the claimed “before building”:** the check is **after** `build.sh` (`gate.sh:13-17`), not before. `build.sh` does `bun install --frozen-lockfile` then compile. Tampered vendor still gets compiled; the gate still fails, so nothing publishes. Placement is weaker than advertised, not vacuous.

---

## Blocker 4 — Network-denied acceptance

**PARTIAL**

Placement is what was asked: after `build.sh` (which is the bun install), before tests:

```19:43:scripts/gate.sh
if [[ "${RUN_ONLINE:-0}" != "1" && "${RUN_PERF:-0}" != "1" ]]; then
  export HTTP_PROXY="http://127.0.0.1:9"
  export HTTPS_PROXY="http://127.0.0.1:9"
  export ALL_PROXY="http://127.0.0.1:9"
  ...
  export NO_PROXY="127.0.0.1,localhost"
```

Loopback exempt is real. The egress test’s positive control **survives**, because the SUT does **not** inherit that dead-sink.

That is also the hole. `runBinary` / `startTui` spawn with a **minimal** env, not `process.env`:

```78:95:test/helpers/sandbox.ts
      const base = {
        HOME: home, USER: ..., PATH: "/usr/bin:/bin:...",
        ZCODE_DATA_BASE_DIR: dataDir,
        ZCODE_DISABLE_UPDATE_CHECK: "1",
      };
```

```197:199:test/helpers/sandbox.ts
    env: { ...sandbox.env(), ...(options.extraEnv ?? {}) },
```

Same in `test/helpers/tui-session.ts:102-104`. Gate proxies never reach `dist/zcode`. Gate also never sets `ZCODE_HTTP_PROXY` / `ZCODE_NO_PROXY`, which is what the vendor actually maps (`vendor/zcode.cjs` `parseEnvConfig`: `ZCODE_HTTP_PROXY` → `network.httpProxy`; `sanitizeZCodeRuntimeEnvInPlace` strips the standard names after capture).

So: bun-test process is denied; **the product binary under test is not**. The “whole test phase” claim is false for the SUT. TUI e2e, plugin commands, and every headless case except the one recorder test can still hit `zcode.z.ai`.

Positive control still works because the recorder test sets its own proxies via `extraEnv` (see blocker 5). Original “minimum to reverse” second disjunct is met **for that one run**. The gate-level deny is theater.

---

## Blocker 5 — Egress fail-open

**CLOSED** (docs mostly honest)

```226:254:test/headless.e2e.test.ts
          HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
          HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
          ALL_PROXY: `http://127.0.0.1:${proxy.port}`,
          ZCODE_HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
          ZCODE_HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
          NO_PROXY: "127.0.0.1,localhost",
          ZCODE_NO_PROXY: "127.0.0.1,localhost",
      ...
      expect(undisclosed).toEqual([]);
      expect(seen.length).toBeGreaterThan(0);
```

Empty `seen` no longer passes. Native `ZCODE_HTTP_PROXY` / `ZCODE_NO_PROXY` exist in the blob (`vendor/zcode.cjs` offsets ~595495 / ~595517). `ZCODE_HTTPS_PROXY` does **not** exist in the vendor — harmless extra.

`docs/EGRESS.md:7-9` now states the residual (UDP / pinned sockets / proxy-ignoring stacks) instead of implying a total network cage. Allowlist vs test is honest enough: production disclosure is the table; the offline probe only permits `zcode.z.ai:443`.

**Residuals:** still one headless `-p`; CONNECT parsed per TCP chunk (fragmentation); cannot distinguish refresh vs `wss://zcode.z.ai/ws` on the same host; “nothing observed suggests such traffic exists” is unfalsifiable for the undocumented channels. Not fail-open anymore.

---

## Blocker 6 — D22/D23, mock race, Workflow vacuity

**CLOSED** (assertion-quality residuals)

**D22 retracted / D23 documented** in `docs/ASD-ST100.md:92-93`. Test header matches D23 (`test/tui.e2e.test.ts:145-151`): agent-loop cases omit `tuiEnv()`.

**Mock race killed.** Tool calls go only to requests that advertise the tool:

```226:232:test/helpers/model-server.ts
        const advertised = s.requireAdvertised === false || (
          Array.isArray(body?.tools)
            && body.tools.some((t: any) => (t?.function?.name ?? t?.name) === s.toolName)
        );
```

`requireAdvertised: false` is defined (`model-server.ts:42`) and **unused** in tests. Headless Bash uses the default (`true`). The claim “exists only for the headless Bash test” is wrong; the flag is dead. That is fine.

**Allow executes.** Dialog + `numberShortcuts: true` (`packages/tui/src/index.ts:3435-3440`); choices are Allow once / Always / Deny+feedback / Deny (`interactions.ts:115-148`); digit `1` is first item (`choice-dialog.ts:268-288`). Workspace side effect is load-bearing:

```186:186:test/tui.e2e.test.ts
        expect(await workspaceFiles()).toContain(TOOL_MARKER);
```

**Deny/Esc skip** via missing marker (`tui.e2e.test.ts:214`, `:240`). Deny additionally asserts `role === "tool"` + deny/permission (`:218-221`). Esc returns `null` → `{ decision: "deny", reason: "Cancelled by user" }` (`index.ts:3443`).

**Workflow replaced.** Comment-only “Tool not found” (`headless.e2e.test.ts:166-168`) — **no test asserts that string**. Replacement coverage is real: headless Bash asserts tool-role content (`headless.e2e.test.ts:183-185`); eval-replay drives the helper path (`test/unit/eval-replay.test.ts`).

**Residuals (same class Codex already killed once):**
- Allow’s “tool-role result” is `JSON.stringify(last.body).toContain(TOOL_MARKER)` (`tui.e2e.test.ts:188-189`). Marker is already in the assistant tool-call **args** (`touch ${TOOL_MARKER}`). Execution is proven by the file, not by a tool-role message.
- Mock still emits `followUpText` on any later advertised request without requiring a tool result (`model-server.ts:127-132, 230-232`). Esc/Allow can go green without a correlated result.
- Esc does not assert tool-role cancel text.

The inverted D22 contract is gone. Permission dialog + Allow-executes + Deny-skips are real.

---

## Smaller fixes

| Claim | Verdict | Evidence |
|---|---|---|
| Eval-replay signal forward + SIGKILL escalate | **CLOSED**, no test | `src/entry.ts:94-120`: SIGTERM/SIGINT/SIGHUP → child, 2s SIGKILL, then `await child.exited`. Codex asked for a nonterminating-evaluator test; `eval-replay.test.ts` has none. |
| `~` expand + per-destination preflight + atomic settings | **OPEN** on call order | `resolveBase` exists (`state-isolation.ts:35-40`) but **both** entries call `preflightStateDir()` **before** `applyStateIsolation()` (`src/entry.ts:159-164`, `src/npm-entry.ts:32-37`). `ZCODE_DATA_BASE_DIR=~/isolated` is still preflighted as a literal `~` path; vendor expands later — the exact Codex P2. Per-destination loop runs before defaults are set; unset `ZCODE_SESSION_DB_PATH` → `dirname("") === "."` so it preflights **cwd**. Atomic publish is real: tmp `wx` + `writeSync` + `linkSync` + EEXIST (`state-isolation.ts:81-104`). No `~`/preflight unit tests. |
| `stop()` cleanup guard | **CLOSED** | Early return (`index.ts:5705-5706`); fallible cleanup in try (`5707-5724`); `ui.stop()` in its own try (`5733-5737`). Crash handler also guards (`859-864`). |
| Contract vocab incl. tool events | **CLOSED** | `test/unit/contract.test.ts:50-62` includes `tool_call_scheduled/started/result`, `permission_requested`, `streaming_tool_ledger_updated`. |
| Provenance cli-config commit | **CLOSED** | `vendor/PROVENANCE.md:13` says `f9f4bca`. `git log --follow --diff-filter=A -- vendor/cli-config.cjs` is `f9f4bca`. |
| `macos-15-intel` | **CLOSED** | `release.yml:70-72`. GitHub’s Intel image label through Aug 2027. |

---

## Overall: **SHIP** for tagging v0.16.6

Judge the pipeline, not `package.json` still at `0.16.5`.

The six tag-blockers from round 1 are no longer P0/P1 holes in the **release path**: verified install, executed-bytes binding, vendor hash in CI, egress positive control, D22 inverted tests replaced. Under their own rule (“no tag until R1 + R2.1–2.2 controls fail when the claim is false”), this is shippable.

Do not confuse that with “clean.” I would still not call the offline gate a network cage, and I would not ship the `~` preflight as “fixed.”

**Would flip back to NO-SHIP:** if you treat “dead-sink covers the whole test phase” as load-bearing rather than the one-run recorder. In code, that claim is false (`sandbox.env()` drops the proxies; vendor wants `ZCODE_*` anyway).

**Before tag-prep, cheap remaining work (not blocking under their rule):**
1. Pass `HTTP_PROXY`/`ZCODE_HTTP_PROXY`/`NO_PROXY`/`ZCODE_NO_PROXY` through `sandbox.env()` from the parent, or set the dead-sink in `sandbox.env()` when those vars are present — otherwise delete the gate.sh comment that pretends the suite is denied.
2. Call `applyStateIsolation()` **before** `preflightStateDir()`; expand explicit `ZCODE_SESSION_DB_PATH` / `ZCODE_LOG_DIR` too; stop preflighting `dirname("")`.
3. Job-level `contents: write` on publish only.
4. Allow test: filter `role === "tool"` like Deny/headless, not the whole body.
5. One eval-replay test that SIGTERMs a sleeping helper and checks the grandchild dies.

`workflow_dispatch` dry-run of the four-target verify step is the right last operational check; this audit did not watch a live Actions run.
