# ASD-ST100 — ZCode CLI: System Technical Assessment & Remediation Plan

| | |
|---|---|
| Doc ID | ASD-ST100 |
| Status | Active — findings verified against tree at commit `67b9e30` (workdir 2026-09-19) |
| Method | 2 independent agent audits (TUI/fork, platform/release) + codex `gpt-6-astra` staff review + grok `grok-4.6` adversarial critique (tree-grounded) + author first-principles re-derivation. Severities: **P0 = do not tag a release until fixed** (ships broken/lying product to strangers), P1 = fix in next release, P2 = scheduled, P3 = backlog. Every finding carries evidence. |
| Companions | [docs/tui/RESEARCH.md](tui/RESEARCH.md) · [ARCHITECTURE.md](tui/ARCHITECTURE.md) · [PARITY.md](tui/PARITY.md) · [TESTING.md](tui/TESTING.md) · raw reviews in [docs/tui/reviews/](tui/reviews/) (`codex-asd-st100.md`, `grok-asd-st100.md`, plus the fork-round reviews) |

---

## 1. First principles — what this system must be

Strip the accidental. The product is: **run Z.ai's proprietary agent engine,
unmodified, on a stranger's machine, with a terminal UI we own, and prove it works
without access to any of our machines.** Six obligations follow; every finding in §4
violates or risks one of them:

1. **O1 — Works from nothing.** A stranger with bun installs and runs headless + TUI
   with only their own credentials. No `~/.zcode-standalone`, no ZCode.app, no
   developer-machine residue.
2. **O2 — Truthful verification.** Every green claim (gate, tests, parity matrix,
   docs, "offline") is produced by something that fails if the claim is false.
3. **O3 — Owned but pinned.** The TUI is ours (fork), the engine is theirs; the
   boundary is an explicit, versioned contract monitored for drift in **both**
   directions (kingsword09 *and* Z.ai core).
4. **O4 — Reproducible provenance.** Anything published is buildable from a git
   commit by a script, with the fork's freshness and the vendor blob's identity
   provable.
5. **O5 — Honest failure.** Unsupported things (node, Windows, musl, no Chrome, no
   native addons) say so at the right layer — no opaque crashes, no silent
   degradation, no bricked terminals.
6. **O6 — Say what ships.** Egress (telemetry, remote control, plugin CDN), shared
   state, and defaults are disclosed; "isolation" means isolation.

## 2. Load-bearing assumptions (audited)

| # | Assumption | Status | Evidence |
|---|---|---|---|
| A1 | Fork TUI is behavior-compatible with core 0.16.5 | **Holds** — event vocabulary verified string-by-string against vendor (`tool_call_*`, `model_*`, `subagent_message`, `step-*`) | agent audit F6 |
| A2 | Core supplies every capability the TUI exposes | **Partially false** — `listPluginReferences` never supplied (`@plugin` autocomplete dead in binary), `initialTuiMode`/`initialPlanEnabled` not forwarded (workaround exists), core's `stdin`/`stderr` options ignored | D10 |
| A3 | There is a contract between core and TUI | **No protocol exists** — compatibility is string-matching inside a minified blob; `RuntimeAdapter` has no version; nothing freezes method names or event vocabulary in CI | D3, G7 |
| A4 | The vendor blob we ship is auditable | **No** — 11.4 MB `vendor/zcode.cjs` has no extract recipe, no SHA256SUMS, no recorded source (app version, sync commit) | D4 |
| A5 | Isolation (`ZCODE_DATA_BASE_DIR`) covers user state | **False for sessions** — credentials/providers isolated; session DB, logs, TUI settings live in shared `~/.zcode/cli/` | D6 |
| A6 | The gate certifies releases | **False** — release.yml bypasses it; no PR/push CI exists at all; gate defaults included live-API perf | D1, D2 |
| A7 | Published artifacts are trustworthy | **No** — unsigned darwin binaries (Gatekeeper), `curl \| chmod` install with no checksum step, floating Action tags, no `bun` pin | D2 |
| A8 | Long-session resources are bounded | **Mostly true** (editor history capped 100, transcript 480 blocks/2M chars, turn diffs 20, completed turn ids 32); real leaks: unbounded `queuedFollowUps`, two unbounded Sets, plugin catalog cached forever, 1 s `isDeepStrictEqual` projection poll (CPU), unbounded on-disk sqlite | D16 |
| A9 | The binary crashes safely | **No crash-restore path** — a throw in a renderer leaves the user's terminal in alt-screen/raw/mouse mode; no `uncaughtException`→`ui.stop()` | D8 |
| A10 | Engine egress is understood and disclosed | **No** — Aliyun ARMS RUM URL, `wss://zcode.z.ai/ws` remote control, intranet probe `studio.zcode-ai.com:12345`, official-plugin CDN fetch with `plugins.enabled: true` — all in the shipped blob, none documented, no verified off-switch | D9 |

## 3. Mistakes we made (each with the lesson)

| # | Mistake | Root cause | Lesson |
|---|---|---|---|
| M1 | `gate.sh` rewrite defaulted `RUN_PERF=1` — the "offline" gate made ~6 real authenticated API calls | Copied old-gate precedent while claiming a new guarantee | When restating a guarantee, derive every default from the guarantee, not precedent |
| M2 | e2e helper signature bug: `startTui(sandbox, ["tui"], {extraEnv})` silently dropped mock-server env for the whole campaign | No typecheck across the helper boundary; call "worked" by default-arg coincidence | Typecheck `test/` in gate; helpers get interfaces |
| M3 | `/status` + `/help` e2e "passed" on autocomplete-popup text, not panels | Weak regexes chosen for speed | Assertions must name content only the claimed UI state can produce |
| M4 | PARITY.md marked ~20 rows `gate: T3` with no tests, wrote a gate rule nothing enforces, and (per grok) still said vendor ships "until the gate is green" while build.sh already ships the fork | Documentation written ahead of reality, then believed — twice | The Verify column references real test names or says `none`; doc-vs-tree drift is a release blocker, not a nit |
| M5 | "Isolation" claims were read-path audits; write paths (shared `setting.json`, session DB, logs) were never audited | Inherited upstream path semantics, documented intent | Isolation claims require a write-path audit |
| M6 | README/TROUBLESHOOTING/OPTIONS still describe the pre-fork world | Per-campaign doc edits, no re-baseline | Every milestone ends with a docs re-baseline against the tree |
| M7 | Fork deps declared in root devDependencies, not `packages/tui/package.json` | Hoisting made it work | A package's manifest declares what its source imports |
| M8 | Our own audit first reported "unbounded editor input history" — grok proved it is capped at 100; the real leaks were elsewhere | A finding repeated from an earlier review without re-verification | Findings get re-verified against the tree each round, including our own |

## 4. Findings

### 4.1 Defects & risks

| ID | Sev | Finding | Evidence | Fix (one line) |
|----|-----|---------|----------|----------------|
| D1 | **P0** | No PR/push CI exists — only tag-gated `release.yml`. The suite/gate/visual pipeline runs only on developer machines; a broken or hostile PR never sees a check | `.github/workflows/` (1 file) | Add CI workflow: offline gate on push/PR |
| D2 | **P0** | Releases ship unverified bits: 4 unsigned binaries, no checksums, `curl \| chmod` README install with no verify step, floating Action tags, unpinned `bun: latest`, darwin targets never executed, version not asserted vs tag | `.github/workflows/release.yml:19-26`, README install section | Pin actions+bun; gate before upload; per-target smoke incl. darwin execute; SHA256SUMS + verified install docs |
| D3 | **P1** | Eval-helper replay in the compiled binary crashes **after successful execution**: vendor helper nulls global `process`; our replay then hits `process.exit` → TypeError → exit 1 → parent marks the workflow failed | `src/entry.ts:65-74`, `vendor/zcode.cjs:3368,3406` (codex repro: `return 42` succeeds, then crashes) | Preserve a private `process` ref; drive the helper lifecycle explicitly; e2e a real helper workflow |
| D4 | **P1** | No vendor provenance: no extract recipe, no checksums for `vendor/zcode.cjs`, no recorded (app version, sync commit) identity | repo `vendor/`, LICENSE-NOTE | `vendor/PROVENANCE.md` + SHA256SUMS + extract script |
| D5 | **P1** | Isolation is false for sessions: session DB (`~/.zcode/cli/db/db.sqlite`), logs, and TUI settings live outside `ZCODE_DATA_BASE_DIR`; wiping `~/.zcode-standalone` keeps chats; desktop upgrades can destroy CLI sessions; desktop MCP/hooks/plugins become CLI behavior | `vendor/cli-settings-default.json:12`, `packages/tui/src/cli/config-paths.ts:6-10`, `model-access.ts:164-190` | Point db/logs/settings at the data-dir override (or document loudly); settings merge-on-write; `wx` creation |
| D6 | **P1** | No crash-restore: no `uncaughtException`/`unhandledRejection` → `ui.stop()`; one renderer throw bricks the user's terminal (alt-screen/raw/mouse left on); `/login` suspend restore untested | `packages/tui/src/index.ts` dispose path; `index.ts:1290-1310` (login spawn `stdio: inherit`) | Fork: top-level crash handlers calling `ui.stop()`; e2e asserts terminal state after `/login` suspend |
| D7 | **P1** | npm publish integrity (if npm ships this cut): `bin` → gitignored artifact, no prepack, `build.sh all npm` silently drops `npm` target, manual publish outside CI, tarball provenance unproven | `package.json:9`, `build.ts:27-28` | prepack builds entry; `all` respects explicit targets; CI publishes on tag after gate |
| D8 | **P1** | Gate not offline + machine-bound: `RUN_PERF=1` default (live API); tier 3 requires the developer's real credentials + machine-derived secret → CI can never run it; relative binary path breaks after `cd`; test.sh tui case hangs/accepts any exit; perf.sh silently exits 0 with no measurements on Linux | `scripts/gate.sh:37,43`, `scripts/perf.sh:16,30-44,53`, `scripts/test.sh:18,58`, `test/helpers/sandbox.ts:109-117` | `RUN_PERF=0` default; synthetic credential fixture; absolute paths + timeouts + strict exits; perf self-validates |
| D9 | **P1** | Native addons not packaged: pi-tui darwin/win32 `.node` prebuilds not copied beside the binary; Linux modifier/image support silently degrades; app-bundled `rg/bfs/ugrep` trusted from `/Applications/ZCode.app` without hash | pi-tui `native-module-path.js`, `src/entry.ts:105-115` | Package-or-disclose: copy prebuilds where present, print Linux degradation notice, document tool-resolution order |
| D10 | **P1** | Contract gaps vs core 0.16.5: `listPluginReferences` never supplied + dead in-binary fallback (`@plugin` autocomplete silently empty); `initialTuiMode` re-read workaround; core `stdin`/`stderr` ignored; **no protocol version, no CI freeze of adapter/event vocabulary** | `packages/tui/src/index.ts:1162`, `plugin-references.ts:132-152`, `index.ts:821-840`, `types.ts` | Shim sets `ZCODE_APP_CLI_EXECUTABLE/_ENTRY`; add contract test freezing `runTui` exports + adapter names + event vocab vs vendor; add `protocolVersion` to RuntimeAdapter |
| D11 | **P1** | Engine egress undisclosed: ARMS RUM endpoint, web remote-control relay, intranet probe, official-plugin CDN with `plugins.enabled: true` (network code-adjacent load, unpinned) — no documented off-switch | `vendor/zcode.cjs` (URLs), `vendor/cli-settings-default.json` | Disclosure page (README/ENV) + verify/set telemetry-off defaults in this distribution; pin or disable plugin CDN |
| D12 | P2 | Parity fiction: `gate:` rows without tests (~20 commands/keybindings/flows); matrix `Verify` column overstates; gate.sh doesn't enforce rows | `docs/tui/PARITY.md` vs grep of `test/` | Build missing T3 scenarios (§6 R3); matrix references real tests or `none` |
| D13 | P2 | PARITY overlay statement ships a lie: doc says vendor overlay ships until gate green; build.sh already overlays the fork | `docs/tui/PARITY.md:7` vs `scripts/build.sh:23-32` | Reword ledger (done for fork rows) + re-baseline statement |
| D14 | P2 | node users get an opaque crash (`import.meta.require`, bun shebang; `engines` informational) | `dist-npm/entry.js` preamble | Bun-runtime guard banner |
| D15 | P2 | Read-only/unusual HOME: `--version` passes, `-p` fails on `~/.zcode/cli/db` writability; npm-entry lacks homedir fallback; settings creation race (`existsSync`+write can truncate a concurrent create) | `src/entry.ts:79,89`, `src/npm-entry.ts:26,37,39` | Writability preflight + coherent override; homedir fallback; `flag:"wx"` |
| D16 | P2 | Long-session residuals: unbounded `queuedFollowUps`, unbounded `restoredNoticeSeen`/`backgroundCoordinatorMessageIds` Sets, plugin catalog cached forever, 1 s full-projection `isDeepStrictEqual` poll while tools run (CPU), unbounded on-disk sqlite + resume RAM spike | `packages/tui/src/input-queue.ts:78-82`, `index.ts` poll paths | Caps + cache invalidation + diff-based poll; sqlite policy documented |
| D17 | P2 | Update-check would phone upstream (`registry.npmjs.org/zcode-app-cli`) if enabled; `ZCODE_DISABLE_UPDATE_CHECK=""` re-enables via `??=`; `refreshUpdateCache` ungated; banner recommends upstream package | `packages/tui/src/cli/update-check.ts:10,129-171`, `src/entry.ts:99` | Fork-retire the updater or retarget; gate `refreshUpdateCache` |
| D18 | P2 | Direct `bun run build.ts` bypasses fork rebuild/overlay (stale TUI); overlay failures swallowed (`>/dev/null`); silent stub build possible in principle | `scripts/build.sh:19-31`, `build.ts:42` | Single build entry point; surface overlay logs; fail on stub selection |
| D19 | P3 | Debug event log writes session content world-readable under `ZCODE_TUI_DEBUG_EVENTS` | `packages/tui/src/index.ts:5667` | Mode 0600 + redaction |
| D20 | P3 | Credential key derived from identifiers (platform:homedir:username); file perms are the real defense (upstream behavior, reproduced in tests) | `vendor/zcode.cjs:2115` | Long-term OS-keychain secret + migration; near-term document + perms |
| D21 | P3 | Versioning: `package.json` version = core version; TUI fork version invisible — cannot ship TUI-only fixes meaningfully | `package.json:2`, `packages/tui/package.json` | Independent TUI version + release notes convention (part of D10 protocol work) |

| D22 | — (retracted) | **Mis-test, not a product defect.** We first reported "the interactive runtime drops tool_use"; both judges refuted it and the corrected tests now prove the full loop works in the TUI: tool_use → permission dialog → Allow/Deny/Esc → execution → result round-trip. Two real lessons: (1) `echo` is auto-allowed as a safe command — permission tests must use a write command (`touch`); (2) our mock handed the tool call to whichever request arrived first, and the TUI's background title-generation request (tools: []) legitimately arrives first and discards tool calls — the mock now serves tool calls only to requests advertising the tool. The Workflow-tool e2e was separately vacuous (marker present in tool-call args; "Workflow" is not a registered headless tool) and was replaced by a Bash tool e2e + direct eval-replay tests | `test/tui.e2e.test.ts` agent-loop describe; `test/helpers/model-server.ts`; `test/unit/eval-replay.test.ts` |
| D23 | P2 | With `ZAI_BUSINESS_BASE_URL`/`ZCODE_BASE_URL` redirected to a generic endpoint, the interactive session routes through the coding-plan business API where the tool loop does not run (tool_use silently dropped; verified twice). Only affects our test-environment redirect design — real usage and the provider-fixture baseUrl path execute tools — but any future test that mixes the redirect with tool flows will silently lose the loop | `test/tui.e2e.test.ts` header comment; mock-server tool-use scenario |

### 4.2 Gaps — what is left

| ID | Gap | Plan |
|----|-----|------|
| G1 | Agent-loop e2e absent: mock server streams text only — no tool_use, no permission prompts, no choice dialogs. The product's core loop has zero coverage | Mock-server tool_use + `requestPermission` scenarios (R3) |
| G2 | Dual-run golden harness (fork vs vendor overlay, identical keyscripts, screen diff) — recommended, unbuilt | After G1 (R3) |
| G3 | Upstream drift watchers absent — neither kingsword09 nor Z.ai core 0.16.x monitored | Weekly CI job: `git ls-remote` + release-API check → open issue (R5) |
| G4 | Out-of-checkout binary validation (native addon resolution, SEA asset paths) never run | CI step: run binary from clean dir (R2) |
| G5 | Performance budgets stated but unmeasured (startup ≤400 ms, keystroke echo <16 ms, redraw coalesce ≤8 ms, markdown cache >90%) | Offline perf harness extension (R5) |
| G6 | Windows/musl unsupported and undocumented as non-goals | Non-goals section (R4); optional musl target |
| G7 | PNG captures non-deterministic (spinner frames/timing) — human/judge review only, not pixel gates | Accept; document; optional spinner-cell normalization for coarse hashing |
| G8 | npm publish blocked on fresh user npm token (long-standing) | User action; then R1 item 5 |
| G9 | Migration/version story absent: no export/import, no resume schema check, no "what happens to sessions on logout/uninstall" | One-page story then enforce (R2) |
| G10 | Session DB/log isolation + docs re-baseline ride R2/R4 | — |

## 5. Verification baseline (what IS proven, as of 67b9e30)

- 44/44 tests: 19 logic, 4 whole-app in-process (terminal seam, streamed turn,
  dark/light theme cell-signature, /status), 21 binary e2e (15 headless incl.
  retry/401/500/SSE-corruption/resume/attach; 6 TUI with strengthened assertions).
- Visual: 6 scenarios judge-passed 6/6 (`artifacts/tui/`), renderer pixel-honest.
- Fork provenance: upstream `b8d8e95` contains every module the old vendor bundle
  carried; event vocabulary verified against `vendor/zcode.cjs` (A1).
- Artifacts: native binary (fork TUI inlined, stub string absent) and npm prebundle
  (19.7 MB, self-contained incl. core+TUI+deps) both pass `--version`; node-runtime
  failure mode documented (D14).
- External review record: codex staff review (14 findings, 5 suspected-and-refuted
  with evidence), grok adversarial critique (10 missed system-level issues, severity
  challenges — integrated above), 2 agent audits.

## 6. Remediation roadmap — the goal and the todo list

> **Goal (one sentence):** make the next tagged release one a stranger can install
> and we can prove — PR CI and a gated, checksummed, executable-release pipeline;
> an offline, credential-free test gate; eval-replay fixed; sessions truly isolated
> and egress disclosed — then close the agent-loop test gap.

### R1 — P0/P1: "do not tag until done" (release integrity)
- [x] 1.1 Done: `.github/workflows/ci.yml` — full offline gate on macos-14, pinned bun 1.4.2 + action SHAs; green run 35474497560 (2026-09-19). (D1)
- [x] 1.2 Fixed: helper replay re-executes the binary in a guarded child (the workflow sandbox nulls `globalThis.process`, so in-process replay crashed after success); argv normalized to the node eval layout; event loop drains instead of a forced exit. Real-helper e2e: mock `tool_use` → Workflow tool → helper subprocess (D3).
- [x] 1.3 Synthetic credentials: sandbox mints AES-GCM `enc:v1` records under a fixed test secret (both credential paths written); `installCredentials` removed from all tests/scripts; tier 3 green locally. CI verification rides 1.1.
- [x] 1.4 Gate honesty: `RUN_PERF=0` default; absolute binary paths; test.sh tui case `timeout`+`</dev/null`+strict exit; perf self-validates (D8). *(acceptance: `bash scripts/gate.sh` passes with outbound network blocked — default run verified locally 2026-09-19; formal network-denied CI verification rides R1.1)*
- [x] 1.5 Release workflow rewritten: gate job → per-target build matrix (darwin-arm64 native, darwin-x64 on real Intel runners — Rosetta cannot run AVX binaries, linux-x64 native, linux-arm64 under qemu — every binary executed) → tag/version assert → SHA256SUMS → publish. `workflow_dispatch` dry-run without publish. README checksum note rides R4. (D2)
- [x] 1.6 Done: `vendor/PROVENANCE.md` (origin table, local-modification list, verify command) + `vendor/SHA256SUMS` (verified locally). (D4)
- [x] 1.7 Done: fork routes uncaught exceptions/rejections through `ui.stop()` (removed on run end so /login suspend cycles do not stack handlers); child-process crash fixture asserts restore sequences; pty e2e asserts `/login` suspend → command → resume. SCOPE: the crash e2e exercises the fork's handler via the terminal seam, not the compiled binary (no deterministic binary-level crash trigger); the vendor also installs its own process error logger. (D6)

### R2 — P1: truth about state and boundaries
- [x] 2.1 Done: runtime natively honors `ZCODE_STORAGE_DIR`/`ZCODE_SESSION_DB_PATH`/`ZCODE_LOG_DIR` — the wrappers default all three into the data dir (no vendor patching); `ensureCliSettingsFile` creates settings with `wx` (EEXIST = concurrent writer wins); writability preflight fails loudly; settings mirror stays at `~/.zcode/cli/setting.json` as the loud documented exception (docs/ENV.md). e2e asserts db+logs inside data dir and nothing under shared $HOME. (D5, D15)
- [x] 2.2 Done: `docs/EGRESS.md` allowlist + disclosure rule; egress ENFORCED by a recording-proxy e2e — a headless run may only contact `zcode.z.ai:443` (builtin-provider refresh; empirically caught by the probe, fails gracefully offline). RUM/CDN/remote-control/update-check verified silent. Update-check disabled by default. (D11)
- [ ] 2.3 Native addons: package-or-disclose (copy `.node` beside binary where present; Linux degradation notice); document tool-resolution order (D9).
- [ ] 2.4 Contract: `protocolVersion` on RuntimeAdapter; CI contract test freezing `runTui` exports + adapter method names + event vocabulary vs vendor (D10); independent TUI version convention (D21).
- [ ] 2.5 If npm ships: prepack, `all` keeps explicit targets, bun-guard banner, CI publish (D7 — needs G8 user token).
- [ ] 2.6 Out-of-checkout binary validation step in CI (G4).

### R3 — P1: prove the agent loop
- [x] 3.1 DONE (corrected after judge round 1 — see D22/D23): mock serves tool calls deterministically (only to requests advertising the tool); headless Bash tool_use e2e asserts the tool-role result message; TUI permission e2e proves the REAL loop — dialog (title/risk/command) → Allow once executes the tool (workspace side effect + tool-role result) → Deny and Esc skip execution and report back. Helper-subprocess coverage lives in test/unit/eval-replay.test.ts (poisoned shim, drain, argv, stdin, error). (D12, G1)
- [x] 3.2 T3 scenarios shipped (test/tui.e2e.test.ts "tui commands"): /model picker, /diff browser incl. clean-tree notice, /search usage, Ctrl+C interrupt of a per-chunk-slow stream (→ "Turn cancelled"), rewind double-Esc browser, exit token summary. PARITY references ride R4. (D12, D13)
- [ ] 3.3 Dual-run golden harness fork-vs-vendor on the growing scenario set (G2).

### R4 — P2: docs re-baseline (rides along with R1/R2)
- [ ] 4.1 TROUBLESHOOTING TUI section rewrite; README/OPTIONS/TESTING attribution + real sizes; ENV.md additions (`ZCODE_DISABLE_UPDATE_CHECK`, `ZAI_BUSINESS_BASE_URL`, egress table); stale `src/bin.js` refs; non-goals section (Windows/musl/Chrome); link ASD-ST100 + docs/tui from README (M6, G6).

### R5 — P2/P3 backlog
- [ ] 5.1 Monolith extractions: slash-dispatch table with `allowedDuringTurn`, `buildChrome(mode)` unification, autocomplete derived from dispatch; low-risk pure-function extractions (permission preview, applyExecutionState).
- [ ] 5.2 Long-session: queue/Set caps, plugin-cache invalidation, diff-based poll, sqlite policy (D16).
- [ ] 5.3 Upstream drift watchers for kingsword09 AND Z.ai core (G3); musl target; perf-budget harness (G5).
- [ ] 5.4 Updater fork-retire/retarget (D17); debug-log 0600+redaction (D19); credential-secret upgrade path (D20); fork-deps manifest move (M7).

**Ship rule (adopted from grok's challenge):** no tag until R1 is fully checked and
R2 items 2.1–2.2 are done. R3 gates the *following* minor release.

---

*IDs: D=defect, G=gap, M=mistake, A=assumption, R=remediation. Raw external
reviews: `docs/tui/reviews/codex-asd-st100.md`, `docs/tui/reviews/grok-asd-st100.md`.*
