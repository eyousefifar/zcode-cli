**NO-SHIP for v0.16.6 at `8f2f750`.** Several fixes are sound, but release integrity, replay cancellation, and verification gaps remain. D22’s conclusion is also unsupported: the interactive runtime contains a tool loop, and the test can deliver its tool call to background title generation.

All anchors below refer to `8f2f750`. HEAD advanced to `fe5a46d` during the review; subsequent commits and concurrent edits are outside this verdict.

1. **P1 — Eval-replay cancellation kills the wrapper and leaves the actual evaluator running.**

   **Evidence:** [src/entry.ts:89](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/src/entry.ts#L89); `vendor/zcode.cjs:3190`, `hws/evaluateMetaExpression`; `vendor/zcode.cjs:3406`, `_Bn/runScriptWorkflowChild`.

   The new wrapper spawns another process and awaits it without forwarding signals. Both vendor callers cancel through `.kill()` on their immediate child. They then await `close`, which can remain pending because the surviving evaluator holds stdout/stderr open.

   I reproduced this using the existing compiled binary: after SIGTERM, the wrapper exited `-15`, the evaluator remained alive, and it emitted delayed output one second later. An indefinitely running meta expression can therefore defeat the vendor’s five-second timeout.

   **Fix:** supervise the child’s entire lifetime: forward termination signals, wait/reap, and escalate after a bounded interval. Ensure descendant processes and inherited pipes terminate. Add timeout and cancellation tests with a nonterminating evaluator.

2. **P1 — The Workflow test does not prove successful helper execution.**

   **Evidence:** [test/headless.e2e.test.ts:169](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/test/headless.e2e.test.ts#L169); `vendor/zcode.cjs:76`, `Bir`; `:2864`, `ILt/HB`; `:3190`, `Wfe`.

   Three problems compound:

   - The assertion at line 189 searches the entire request body. Its expected marker already appears inside the original assistant tool-call arguments.
   - The mock returns the success follow-up on its next request regardless of whether a successful tool result exists.
   - The script’s `meta` omits mandatory `description`. Moreover, the vendor’s `ILt` built-in tool table contains no `Workflow` entry despite retaining an `includeWorkflow` filter.

   Thus an unknown-tool or validation-error round trip can satisfy the alleged execution proof. Even if dispatched through the workflow port, this script fails metadata validation before its body runs.

   **Fix:** exercise a supported workflow entry point with valid metadata. Assert the correlated successful result and completed workflow state, excluding the original arguments. Keep an independent Bash execution test for the agent loop.

3. **P1 — D22’s regression test races background requests and encodes an unproven defect.**

   **Evidence:** [test/helpers/model-server.ts:213](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/test/helpers/model-server.ts#L213); [test/tui.e2e.test.ts:163](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/test/tui.e2e.test.ts#L163); `vendor/zcode.cjs:3026`, `CYi`; `:3045`, `FYi/HUt`.

   The mock gives its sole tool call to **whichever request arrives first**. It does not require the requested tool to be present in `body.tools`, or even require a model endpoint.

   The TUI enables background title generation. That request advertises `tools: []`; `CYi` explicitly discards any returned tool calls with reason `tool_calls_returned`. The actual conversation request can consequently receive only the mock’s follow-up text. I reproduced this sequence with the exact mock and title-generation functions in memory.

   Additionally, the request-count assertion is cumulative across earlier tests, and inspecting the final screen cannot establish that no permission or execution event occurred.

   **Fix:** classify model requests, issue tool calls only when that tool is advertised, and maintain separate title/control responses. Require a matching tool result before sending the follow-up. Replace the negative test with execution and explicit Allow/Deny tests; revise D22’s diagnosis.

4. **P1 — The egress test does not enforce its documented guarantee.**

   **Evidence:** [test/headless.e2e.test.ts:206](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/test/headless.e2e.test.ts#L206); [docs/EGRESS.md:3](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/docs/EGRESS.md#L3); `vendor/zcode.cjs:56`, `RQ/fye`; `:62`, `zQ`; `:1917`, `uIr/Zgt/lIr`.

   This has code-specific blind spots beyond the documented raw-socket caveat:

   - Startup removes standard proxy variables after capturing them. The vendor’s normal proxy resolver uses `ZCODE_HTTP_PROXY`; captured standard variables are consulted only by an optional fallback path. The test sets no native proxy variables.
   - An empty `seen` array passes. There is no positive control proving that the relevant transports reach the recorder.
   - Parsing individual TCP chunks and closing immediately can miss a fragmented CONNECT header.
   - Allowing all `zcode.z.ai:443` traffic cannot distinguish provider refresh from the remote-control websocket on that same host.
   - The recorder covers one headless prompt. The separately executed plugin commands and TUI flows are not monitored.

   **Fix:** set native and standard proxy/no-proxy variables, buffer complete headers, and prove interception with transport-specific canaries. Enforce network denial for the runtime test phase and exercise the claimed flows. Narrow endpoint/path and “telemetry-off verified” claims to what the evidence actually establishes.

5. **P1 — The Intel release target uses a retired runner.**

   **Evidence:** [release.yml:70](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/.github/workflows/release.yml#L70).

   `darwin-x64` uses `macos-13`. GitHub retired that image in December 2025; the normal CI job running on `macos-14` does not validate this release matrix. [GitHub retirement notice](https://github.blog/changelog/2025-09-19-github-actions-macos-13-runner-image-is-closing-down/).

   **Fix:** use a supported real Intel runner such as `macos-15-intel`, then execute the complete four-target release dry run. That label is listed in the [current runner inventory](https://github.com/actions/runner-images/blob/main/README.md).

6. **P1 — Release checksums authenticate the downloaded bytes, without binding them to the executed bytes.**

   **Evidence:** [release.yml:117](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/.github/workflows/release.yml#L117), particularly download/checksum generation at lines 131–142.

   Build jobs execute binaries and upload them without preserving a binary digest for later comparison. Publish downloads wildcard artifacts and calculates a fresh checksum manifest over whatever arrived.

   GitHub’s download action performs artifact digest validation, but a mismatch produces a **warning**, not a failing verification step. This workflow can consequently publish altered downloaded bytes alongside freshly matching checksums. This is a verification gap, not a claim that ordinary cross-run artifact replacement is possible. [GitHub artifact validation documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data#validating-artifacts).

   The entire publish job is also tag-gated, so `workflow_dispatch` skips the download/checksum stage despite claiming an end-to-end dry run.

   **Fix:** calculate digests after target execution, bind the handoff to exact artifact IDs, and fail publication unless all four downloaded binaries match the build-produced expectations. Run that verification during dispatch; gate only the final release upload. Restrict `contents: write` to publishing.

7. **P2 — State-path normalization disagrees with the vendor.**

   **Evidence:** [src/state-isolation.ts:21](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/src/state-isolation.ts#L21); `vendor/zcode.cjs:2091`, `zk`; `:2093`, `nl`; `:2116`, `TJr`.

   With an exported literal `ZCODE_DATA_BASE_DIR="~/isolated"`, the wrapper preflights a relative directory containing a literal `~` and derives its log path from that value. Vendor credential/storage resolution expands `~` to the home directory. The checked destination and actual destinations therefore disagree.

   The preflight also checks only the base, so an independently overridden, unwritable database or log destination escapes it.

   **Fix:** expand and resolve the base once, store its absolute value back into the environment, and derive defaults from it. Validate the effective mutable destinations, including explicit overrides.

8. **P2 — Crash cleanup can fail before terminal restoration.**

   **Evidence:** [packages/tui/src/index.ts:854](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/packages/tui/src/index.ts#L854), `onCrash`; [:5704](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/packages/tui/src/index.ts#L5704), `stop`; `test/fixtures/crash-tui.ts:19`.

   `stop()` marks the instance stopped, then performs unguarded cleanup—including subscription disposal—before reaching `ui.stop()`. The crash handler catches any exception and exits anyway.

   Injecting a throwing unsubscribe callback into the exact `stop()` implementation produced `stopped: true`, `uiStopCalls: 0`.

   The fixture also accepts restoration markers emitted at any time, and its virtual terminal cannot establish restoration of real PTY raw mode.

   **Fix:** make terminal restoration unconditional through `finally`, isolate fallible cleanup, and retain a best-effort terminal fallback. Test both exception and rejection paths, including cleanup failure, with restoration observations armed immediately before the crash and a real PTY mode check.

9. **P2 — `wx` prevents truncation but does not publish settings atomically.**

   **Evidence:** [src/state-isolation.ts:50](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/src/state-isolation.ts#L50).

   `writeFileSync(..., { flag: "wx" })` exposes the destination before writing finishes. Another process can observe empty/partial JSON, treat `EEXIST` as successful initialization, and continue. A killed writer can leave that incomplete file permanently.

   **Fix:** write a temporary sibling completely, then publish with an exclusive hard link. The repository already implements this pattern in `packages/tui/src/cli/model-access.ts:99–138`; reuse it.

10. **P2 — Vendor provenance remains incomplete and its checksum rule is unenforced.**

    **Evidence:** [vendor/PROVENANCE.md:12](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/vendor/PROVENANCE.md#L12); [scripts/gate.sh:13](https://github.com/eyousefifar/zcode-cli/blob/8f2f750/scripts/gate.sh#L13).

    The document names an upstream project and application version, but not the immutable sync revision/source artifact and extraction recipe needed to reproduce the patched engine. The table also attributes `cli-config.cjs` to `09b6d14`, where that file is absent.

    All six current vendor checksums passed my check. However, neither the gate nor release build enforces them, so the requirement to update hashes with vendor changes is currently advisory.

    **Fix:** record the exact upstream inputs and extraction/patch procedure, correct the introduction record, and enforce checksum verification before building.

For **Part B**, the normal interactive execution path is present:

| Stage | Actual implementation and anchor |
|---|---|
| TUI supplies permission callback | `packages/tui/src/index.ts:1805`, submission options; `:3368`, permission queue |
| Vendor connects that callback to its broker | `vendor/zcode.cjs:3535`, `wZn/createTuiSubmitPrompt` |
| Interactive and headless construct the same app/runtime | `:3412`, `K8t/createZCodeApp`; TUI caller `:3535`; headless `kVt/runPrompt` at `:3512` |
| Turn enters normal model/tool loop | `:3052`, `$In/executeTurnCommand`; `:3026`, `mIn/runRegularTurnLoop` |
| Model tool calls are extracted and dispatched | `:3025`, `fYi/runModelBackedTurnStepImpl` and `WFe`; `:3056`, `jTn/executeTools` |
| Approval is resolved through the broker | `:2376`, `Wnn/resolveToolPermission` |

The deliberate discard is in **`CYi`’s title-generation path**, at `vendor/zcode.cjs:3026`: it requests `tools: []`, detects returned tool calls, records `tool_calls_returned`, and returns `null`. `FYi/HUt` at `:3045` makes the test’s first prompt eligible for this background work. TUI configuration enables it through `titleGeneration: gZn` at `:3535`; the headless configuration omits it.

I found **no missing switch that activates the ordinary interactive tool loop**. `streamingToolExecution`, checked by `dYi` at `:3025`, controls early execution of eligible tools during streaming; disabling it does not remove the later tool-dispatch path. Disabling title generation would isolate a test, not activate tools.

**App-server could support a TUI adapter, but it is not a drop-in remedy for D22.**

- `WMs/runZCodeProtocolCommand` at `vendor/zcode.cjs:3547` enters `oVn/runZCodeProtocolAgent` at `:3434`, using `X8e` and the NDJSON connection `Q8e` at `:3431`.
- Session create/resume/subscribe/send/stop handlers exist at `:3425`. `session/send` acknowledges admission before execution completes; an adapter must follow events through completion, handle cancellation, and maintain subscription sequencing.
- `G3n/RCs` at `:3421` exposes reverse `interaction/requestPermission` requests. `OCs/DCs` provide user-input and plan-approval interactions. These can drive the existing TUI dialogs.
- It also makes reverse `session/requestRuntimePreferences` requests through `h8n` at `:3428`, and provider-header requests through `F3n` at `:3421`. Ignoring those requests can stall/fail execution; merely responding “headers applied” is not sufficient authentication integration.
- Crucially, app-server calls `q3e(w)` without standalone options at `:3434`. Current TUI startup supplies those options at `:3535`. In `q3e` at `:3412`, they are what create the standalone credential-backed account source and header provider. An adapter must implement the host account/header contract or change that bootstrap.

My recommendation is to repair the mock and prove the existing TUI’s Bash execution and Allow/Deny paths first. App-server uses the same underlying engine and otherwise risks concealing the test race while introducing a substantial authentication and lifecycle migration.

The synthetic credential remediation itself checked out: I passed all five fixture values through the vendor’s exact `wJr/createZCodeCredentialCipher` decrypt function successfully. The default absolute-path storage overrides also correspond to real vendor settings, and CI genuinely invokes the gate with pipeline failure propagation.

**Before tagging:** fix replay cancellation, release runner/handoff verification, and egress enforcement; replace the invalid Workflow and D22 proofs; finish the state/crash/provenance corrections above. Set the distribution’s reported version to `0.16.6`—the vendor CLI version remains `0.16.5` at `vendor/zcode.cjs:3538`—then retain a successful four-target dry run including checksum verification.

I did not rerun the full gate in this read-only environment or independently confirm GitHub’s reported green run. Verification here comprised source inspection, checksum validation, isolated function probes, and the existing-binary cancellation reproduction.