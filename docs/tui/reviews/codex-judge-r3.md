**NO-SHIP for tagging v0.16.6 at `c81bca4`.** Several fixes work, but cancellation, egress enforcement, release binding, and state preflight remain incomplete. I also found new defects in settings publication and dispatch gating.

All code references below are pinned to `c81bca4`. Concurrent uncommitted edits are excluded.

1. **Eval-replay supervision — PARTIAL, P1.**

   [entry.ts:89](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/src/entry.ts#L89) correctly inherits stdin/stdout/stderr, forwards SIGTERM/SIGINT/SIGHUP, and schedules SIGKILL after two seconds.

   Against the existing binary, I verified:

   | Probe | Result |
   |---|---|
   | Single SIGTERM / SIGINT / SIGHUP | Wrapper exits 143 / 130 / 129; pipes close |
   | Evaluator ignores SIGTERM | SIGKILL escalation after approximately 2.01 seconds; exit 137 |
   | Two SIGTERMs | **Wrapper dies from the second signal; evaluator survives and pipes remain open** |
   | Evaluator spawns a subprocess | **Descendant survives cancellation and retains the pipes** |

   The repeated-signal failure is **NEW**: `.once()` removes the handler after the first signal. The process-tree gap also remains: `child.kill()` targets only the evaluator.

   Stdin forwarding passed. Numeric failure propagation works for the tested cases; signal termination becomes a numeric exit status, which is sufficient for the vendor’s nonzero checks. Supervision still needs persistent handlers and bounded cleanup of descendants.

2. **`requireAdvertised` and the title-generation race — PARTIAL.**

   [model-server.ts:220](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/helpers/model-server.ts#L220) closes the specific theft race: a request with `tools: []` cannot consume the sole tool call under the default setting.

   However, every ineligible request receives `followUpText`, even **before any tool result exists**. There is still one global `toolUseServed` flag, no model-endpoint restriction, and no result/call-ID correlation.

   I drove the exact handler through title → conversation → control requests. The conversation received the tool call correctly; the control request received success text and became `requests().at(-1)`. Consequently, assertions using the last request remain order-sensitive, including in headless tests if control requests share the server. This demonstrates the harness weakness; it does not establish that the current headless test actually emitted such a control request.

   Classify requests and issue the conversation follow-up only after the matching tool result.

3. **Headless Bash replacement — CLOSED for the original vacuity defect.**

   [headless.e2e.test.ts:163](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/headless.e2e.test.ts#L163) now requires the marker inside a **tool-role message**. The original assistant arguments and the mock’s final text cannot independently satisfy that assertion. An ordinary `Tool not found: Bash` result cannot satisfy it either.

   This is a meaningful Bash execution regression test. I did not reproduce a current no-execution false pass.

   Its remaining limitation is precision: it accepts a substring in any tool message, without checking the call ID or successful stdout specifically. An error containing the command could satisfy that weaker oracle. A correlated successful result would strengthen it, but the previous guaranteed argument-echo false pass is fixed.

4. **Five direct replay tests / Workflow replacement — PARTIAL; actual Workflow proof remains OPEN.**

   All five tests in [eval-replay.test.ts](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/unit/eval-replay.test.ts#L22) passed. They provide useful replay-layer coverage for poisoned globals, timer draining, exceptions, payload forwarding, and stdin.

   They do **not** replace a successful vendor Workflow integration test. They omit the actual metadata extraction/schema path, the complete hardened runner shim, bidirectional request/response handling, workflow events/completion, and cancellation through the workflow subsystem. The argv test also checks only selected positions, not the complete layout.

   I additionally extracted and exercised the vendor’s actual [`hws`](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/vendor/zcode.cjs#L3190): valid stdin metadata succeeded; a simple infinite evaluation failed after approximately five seconds with exit 143. That is useful transport evidence, but it is neither a committed regression test nor an end-to-end Workflow execution proof through [`_Bn`](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/vendor/zcode.cjs#L3406).

5. **State normalization and destination preflight — PARTIAL, P2.**

   The normalization itself is correct: [state-isolation.ts:22](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/src/state-isolation.ts#L22) expands `~`/`~/`, resolves relative bases, and writes the absolute result back.

   **The callers invoke it too late.** Both [entry.ts:158](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/src/entry.ts#L158) and [npm-entry.ts:31](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/src/npm-entry.ts#L31) run `preflightStateDir()` **before** `applyStateIsolation()`.

   An exact-function probe with `~/audit` showed preflight checking literal `~/audit` and `.`; only afterward did the environment become `/AUDIT-HOME/audit/...`. Default database/log destinations therefore remain unchecked. `dirname("")` producing `.` also introduces an unintended working-directory writability check.

   Explicit database/log overrides receive directory checks, which is an improvement. Normalize and establish effective defaults first, then preflight them. Explicit `ZCODE_STORAGE_DIR` also remains outside these checks.

6. **Atomic settings publication — PARTIAL, NEW P2.**

   [state-isolation.ts:81](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/src/state-isolation.ts#L81) uses the right publication primitive: a sibling temporary file plus exclusive hard link. The sibling keeps the operation on the same filesystem; unlike an ordinary rename, the link preserves an existing destination. Unlinking the temporary name after successful publication preserves the destination.

   Two defects remain:

   - `writeSync()`’s returned byte count is ignored. A short write is followed by publication. With a short-write fault injected into the exact function, it published truncated JSON, `{"c`. The API returns the number of bytes written; completion must be checked or handled by a write-all operation. [Node filesystem documentation](https://nodejs.org/api/fs.html#fswritesyncfd-string-position-encoding).
   - `finally` unlinks the temporary path even when its exclusive `openSync()` failed. A temporary-name collision can therefore delete another invocation’s file. PID plus milliseconds reduces ordinary cross-process collisions, but does not establish ownership.

   Track successful temporary-file creation and write the complete payload before linking.

7. **`stop()` cleanup ordering — PARTIAL; the reported ordering defect is CLOSED.**

   [index.ts:5704](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/packages/tui/src/index.ts#L5704) now reaches `ui.stop()` after a throwing unsubscribe. My exact-method probe returned `uiStopCalls: 1`, fixing the original failure.

   The grouped catch still skips remaining cleanup after the first exception; the same probe showed `unsubscribeWorkflow` was never called. A failure inside `ui.stop()` is swallowed without a terminal fallback.

   The [crash fixture](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/fixtures/crash-tui.ts#L19) remains unchanged: restoration markers are accepted from the entire run, and it does not prove real PTY raw-mode restoration or cover rejection plus cleanup-failure combinations. The fix is sufficient for the specific pre-UI exception, not the entire previous crash-restoration requirement.

8. **TUI Allow / Deny / Esc tests — PARTIAL, P2.**

   Unique filenames within a fresh sandbox close the earlier marker reuse problem. The claimed assertions are nevertheless stronger than the code:

   - **Allow:** checks dialog contents and an actual workspace side effect, but [line 189](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/tui.e2e.test.ts#L169) searches the **whole request body**, not a tool-role result. Assistant arguments can satisfy the alleged round-trip proof.
   - **Deny:** [lines 202–221](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/tui.e2e.test.ts#L202) check absence of the file and a tool-role rejection. This is the strongest of the three, although it still uses the uncorrelated last request.
   - **Esc:** [lines 230–240](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/tui.e2e.test.ts#L230) check only follow-up text and absence of the file. There is **no tool-result assertion**.

   The execution evidence is materially improved. Race-free, correlated permission-result coverage is not yet established.

9. **Intel runner — CLOSED in configuration.**

   [release.yml:73](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/.github/workflows/release.yml#L73) selects `macos-15-intel`, which GitHub lists as an x64 runner. [Official runner inventory](https://github.com/actions/runner-images/blob/main/README.md).

   This closes the retired-label defect. It does not establish a successful four-target run at this commit.

10. **Release digest binding and dispatch verification — PARTIAL, P1.**

    [release.yml:117](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/.github/workflows/release.yml#L117) now records hashes after execution, and publish checks all four sidecars before generating `SHA256SUMS`. Publish-job verification also runs on dispatch.

    **The trust-binding gap remains:** each binary and its expected hash travel in the same downloaded artifact. Substituting both passes validation. Download still uses `pattern: zcode-*` and merged extraction, without exact artifact IDs or independently retained build expectations. This detects ordinary corruption; it does not establish the advertised artifact-swap defense. GitHub’s automatic digest mismatch remains warning-only. [GitHub documentation](https://docs.github.com/actions/configuring-and-managing-workflows/persisting-workflow-data-using-artifacts).

    **NEW P1:** [line 159](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/.github/workflows/release.yml#L159) permits publication on a dispatch targeting a tag. `workflow_dispatch` can target a branch **or tag**, so a documented dry run can publish. Require the push event as well as the tag ref. [GitHub event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

    Workflow-wide `contents: write` also remains unnecessarily broad.

11. **Egress enforcement and gate placement — OPEN overall, P1.**

    The dedicated [egress test](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/headless.e2e.test.ts#L202) now supplies native proxy variables and rejects an empty capture. Those improvements are real.

    They do not close the guarantee:

    - [gate.sh:24](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/scripts/gate.sh#L24) sets only standard proxy variables. The vendor’s normal resolver uses `ZCODE_HTTP_PROXY`.
    - More decisively, [sandbox.env()](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/helpers/sandbox.ts#L78) drops the parent proxy environment. Both binary and TUI launchers explicitly replace the environment with that sandbox object. The gate’s dead sink therefore **does not reach ordinary sandboxed e2e children**.
    - The recorder still closes after the first TCP chunk. Feeding the exact handler `CONN` produced `seen: []` and closed the connection before the remaining header.
    - `seen.length > 0` depends on incidental startup traffic, not a deterministic transport canary. The sandbox is shared across preceding tests.
    - Allowing `zcode.z.ai:443` cannot distinguish refresh from a websocket on that host. Only one headless run is recorded.
    - A dead proxy does not deny proxy-ignoring traffic, nor necessarily fail tests when background network errors are tolerated.

    The control is placed after dependency installation and before tests, which is sensible. Its propagation and enforcement are insufficient.

12. **Vendor checksum gate and provenance — PARTIAL.**

    All six vendor checksums passed. [gate.sh:16](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/scripts/gate.sh#L16) now makes a mismatch fail the overall gate.

    Verification still occurs **after building**, and standalone `scripts/build.sh` does not enforce it.

    The [`cli-config.cjs` introduction correction](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/vendor/PROVENANCE.md#L13) is correct: Git history confirms `f9f4bca`. The engine’s immutable upstream sync revision/source artifact and reproducible extraction/patch recipe remain absent.

13. **Build overlay and contract claims — build CLOSED; contract PARTIAL, NEW P2.**

    [build.sh](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/scripts/build.sh#L17) still rebuilds and overlays the fork before bundling. The three contract tests passed, including byte equality of the existing fork distribution and overlay.

    The event-vocabulary assertion is vacuous as compatibility protection: [contract.test.ts:64](https://github.com/eyousefifar/zcode-cli/blob/c81bca4/test/unit/contract.test.ts#L64) only requires a non-null normalization result. I verified that `totally_unknown_vendor_event` passes the same assertion. It cannot detect renamed events or lost tool/permission fields.

    Also, this file was **not unchanged** in `c81bca4`: five tool/permission event names were added. The added names do not strengthen that oracle.

Verification performed: **8 tests passed, 29 assertions; six vendor checksums passed; additional binary cancellation and exact-source fault probes completed.** Binary probes used the existing `dist/zcode`; I could not rebuild and bind it to HEAD in this read-only environment. I did not rerun the full gate or e2e suites. GitHub access failed, so a successful four-target dispatch at `c81bca4` remains **unverified**, not proven absent.

**Tagging remains blocked** by lifecycle supervision, egress enforcement, and release binding, with the state/settings and proof gaps above still requiring correction. The planned version bump is tag preparation and is **not** counted as a defect.