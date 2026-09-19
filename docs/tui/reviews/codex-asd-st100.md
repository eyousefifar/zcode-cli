I would block the next release. I reviewed the clean tree at **67b9e30**, including the existing native and npm artifacts. **No P0 found; five P1 findings.**

The npm artifact is **not merely a version stub**: it embeds `vendor/zcode.cjs`, `cli-config.cjs`, the forked TUI, and its JavaScript dependencies. The original core file is excluded from the package, but its code is bundled. `@zcode/tui` becomes an internal initializer, so it does not need resolution from the consumer’s `node_modules`. See [generated core](/Users/erfanyousefifar/Codes/zcode-cli/dist-npm/entry.js:95484) and [generated TUI loader](/Users/erfanyousefifar/Codes/zcode-cli/dist-npm/entry.js:318241).

1. **P1 — Compiled workflows crash after successful execution.**  
   [src/entry.ts:65](/Users/erfanyousefifar/Codes/zcode-cli/src/entry.ts:65) imports the helper, then accesses global `process`. The actual helper deliberately sets global `process` to `undefined` ([vendor/zcode.cjs:3368](/Users/erfanyousefifar/Codes/zcode-cli/vendor/zcode.cjs:3368)). Replaying that helper with `return 42` emitted successful completion, then crashed with `TypeError … process.exit`, exit 1. The parent explicitly rejects nonzero child exits ([vendor/zcode.cjs:3406](/Users/erfanyousefifar/Codes/zcode-cli/vendor/zcode.cjs:3406)).  
   **Fix:** Preserve a private process reference and adapt this helper’s execution lifecycle explicitly.

2. **P1 — Tag releases bypass the gate entirely.**  
   [release.yml:21](/Users/erfanyousefifar/Codes/zcode-cli/.github/workflows/release.yml:21) builds all targets, runs only Linux x64 `--version`, then publishes four binaries. No TUI, prompt, workflow, packaged-install, or other-platform execution is required; the smoke check does not even compare the version with the tag.  
   **Fix:** Make publishing depend on the gate and target-specific runtime checks, with a pinned Bun version and tag/version assertion.

3. **P1 — The default “offline” gate makes real authenticated API calls.**  
   [gate.sh:43](/Users/erfanyousefifar/Codes/zcode-cli/scripts/gate.sh:43) defaults `RUN_PERF=1`. [perf.sh:33](/Users/erfanyousefifar/Codes/zcode-cli/scripts/perf.sh:33) performs five real prompts; [perf.sh:40](/Users/erfanyousefifar/Codes/zcode-cli/scripts/perf.sh:40) performs another. They inherit the developer’s environment and working repository. `RUN_ONLINE=0` does not prevent this. Additionally, [build.sh:15](/Users/erfanyousefifar/Codes/zcode-cli/scripts/build.sh:15) can download dependencies.  
   **Fix:** Put every real-service operation behind explicit online opt-in and run offline verification with outbound networking denied.

4. **P1 — The supposedly isolated TUI gate requires personal credentials.**  
   [test/tui.e2e.test.ts:19](/Users/erfanyousefifar/Codes/zcode-cli/test/tui.e2e.test.ts:19) unconditionally calls `installCredentials()`, which reads the developer’s actual login store and recreates its decryption secret ([sandbox.ts:51](/Users/erfanyousefifar/Codes/zcode-cli/test/helpers/sandbox.ts:51), [sandbox.ts:109](/Users/erfanyousefifar/Codes/zcode-cli/test/helpers/sandbox.ts:109)). A clean CI runner fails before testing. The copy also goes under sandbox `HOME/.zcode/v2`, while `ZCODE_DATA_BASE_DIR` points elsewhere.  
   **Fix:** Generate synthetic credential/provider fixtures in the exact runtime paths; remove personal-login access from offline tests.

5. **P1 — Publishing can ship a missing or stale npm executable.**  
   [package.json:9](/Users/erfanyousefifar/Codes/zcode-cli/package.json:9) points at ignored `dist-npm/entry.js`, but there is no `prepack`/publish build hook ([package.json:21](/Users/erfanyousefifar/Codes/zcode-cli/package.json:21)). The default build produces only native output. Worse, `all npm` silently discards `npm` because of [build.ts:27](/Users/erfanyousefifar/Codes/zcode-cli/build.ts:27); I verified the selected build calls without writing artifacts.  
   **Fix:** Add a mandatory npm prepack build, preserve explicitly requested targets, and test the packed package outside the checkout.

6. **P2 — Eval replay has incorrect argv and event-loop semantics.**  
   [src/entry.ts:65](/Users/erfanyousefifar/Codes/zcode-cli/src/entry.ts:65) leaves the virtual entry, eval flags, code, and separator in `process.argv`; Node eval exposes payload arguments instead. Its unconditional exit also drops pending callbacks: a replayed `setTimeout(() => console.log("TIMER_RAN"), 50)` exited 0 without printing.  
   **Fix:** Normalize eval arguments and let pending work drain without falling through into normal CLI startup.

7. **P2 — Direct `build.ts` invocation bypasses the fork rebuild.**  
   [build.sh:19](/Users/erfanyousefifar/Codes/zcode-cli/scripts/build.sh:19) rebuilds and overlays the fork, but [build.ts:42](/Users/erfanyousefifar/Codes/zcode-cli/build.ts:42) simply bundles whatever currently resolves from `node_modules`. Its documented direct invocation can therefore package an older overlay—or fail with the manifest-only stub on a fresh install. The shell-driven path currently matches: both overlay files had identical hashes.  
   **Fix:** Make fork preparation part of the single supported build entry point.

8. **P2 — The gate’s online flag matrix receives an unusable relative binary path.**  
   [gate.sh:37](/Users/erfanyousefifar/Codes/zcode-cli/scripts/gate.sh:37) passes `dist/zcode`, then [test.sh:18](/Users/erfanyousefifar/Codes/zcode-cli/scripts/test.sh:18) changes into `/tmp/zcode-test/work` before executing it. Calls consequently resolve the binary inside that temporary directory.  
   **Fix:** Resolve the binary to an absolute path before changing directories.

9. **P2 — Performance failures can still produce a successful gate step.**  
   [perf.sh:16](/Users/erfanyousefifar/Codes/zcode-cli/scripts/perf.sh:16) uses macOS-specific `stat` and `/usr/bin/time -l`; failures are ignored, measurements need not exist, and the script ends with a successful `echo` ([perf.sh:53](/Users/erfanyousefifar/Codes/zcode-cli/scripts/perf.sh:53)). A broken executable or Linux runner can therefore yield meaningless measurements and exit 0. Separately, the legacy TUI case accepts **any** exit status ([test.sh:58](/Users/erfanyousefifar/Codes/zcode-cli/scripts/test.sh:58)).  
   **Fix:** Validate execution and measurement counts, use platform-appropriate tools, and require a real TUI startup assertion.

10. **P2 — The data-directory override does not support a read-only HOME.**  
    [src/entry.ts:79](/Users/erfanyousefifar/Codes/zcode-cli/src/entry.ts:79) relocates credentials/providers, while the default database remains `~/.zcode/cli/db/db.sqlite` ([cli-settings-default.json:12](/Users/erfanyousefifar/Codes/zcode-cli/vendor/cli-settings-default.json:12)); npm behaves identically. Both artifacts passed `--version` under read-only HOME, but `-p` failed opening that database. They also share settings/session state with the desktop installation.  
    **Fix:** Provide a coherent override for all mutable state and validate its writability before startup.

11. **P2 — First-run settings creation can overwrite concurrently created settings.**  
    Both wrappers perform `existsSync` followed by ordinary `writeFileSync` ([entry.ts:89](/Users/erfanyousefifar/Codes/zcode-cli/src/entry.ts:89), [npm-entry.ts:39](/Users/erfanyousefifar/Codes/zcode-cli/src/npm-entry.ts:39)). Another CLI or desktop process can create the shared file between those operations; the wrapper then truncates it to defaults.  
    **Fix:** Create with `flag: "wx"` and treat `EEXIST` as success.

12. **P2 — Debug event logs can expose session contents through permissive files.**  
    [packages/tui/src/index.ts:5667](/Users/erfanyousefifar/Codes/zcode-cli/packages/tui/src/index.ts:5667) appends complete event objects without redaction or an explicit file mode. When `ZCODE_TUI_DEBUG_EVENTS` is enabled, tool output and session content can land in a file readable by other users under a typical umask.  
    **Fix:** Create diagnostic files with mode `0600` and redact sensitive event fields.

13. **P2 — Default credential encryption uses a predictable key.**  
    [vendor/zcode.cjs:2115](/Users/erfanyousefifar/Codes/zcode-cli/vendor/zcode.cjs:2115) derives the AES key from platform, home directory, and username unless `ZCODE_CREDENTIAL_SECRET` is supplied. Those values are identifiers, not secrets; possession of a copied credential file plus those values permits decryption. File permissions remain the meaningful protection.  
    **Fix:** Use a random secret protected by the OS credential store, with migration for existing credentials.

14. **P2 — Re-enabled update discovery targets the upstream distribution.**  
    [update-check.ts:10](/Users/erfanyousefifar/Codes/zcode-cli/packages/tui/src/cli/update-check.ts:10) queries `registry.npmjs.org/zcode-app-cli/latest`; [update-available-view.ts:9](/Users/erfanyousefifar/Codes/zcode-cli/packages/tui/src/update-available-view.ts:9) recommends installing that package and links kingsword09’s releases. This is dormant by default: wrappers disable checking, and the TUI additionally requires `ZCODE_APP_CLI_VERSION`. An empty disable variable is treated as enabled checking once that version is supplied.  
    **Fix:** Retarget the entire updater to this distribution or remove it.

A few suspected problems did **not** survive verification:

- Windows npm entry paths use `fileURLToPath` and `join` correctly ([npm-entry.ts:10](/Users/erfanyousefifar/Codes/zcode-cli/src/npm-entry.ts:10)); I found no pathname/URL-decoding bug there.
- Current Bun explicitly accepts top-level `bun-*` compilation targets; claiming these four builds necessarily produce native-only binaries would be incorrect. [Bun implementation](https://raw.githubusercontent.com/oven-sh/bun/main/src/runtime/api/JSBundler.rs).
- I found no confirmed committed credential in the inspected files. The hardcoded Aliyun telemetry URL alone does not establish active transmission; the agent telemetry initializer requires a configured OTLP endpoint ([vendor/zcode.cjs:3184](/Users/erfanyousefifar/Codes/zcode-cli/vendor/zcode.cjs:3184)).

Verification: **19 unit tests passed**, shell syntax checks passed, and both artifacts passed version checks with minimal environments. Full packed-install, writable-state prompt/TUI, and four-platform release execution remain unverified because this session is read-only; even pack dry-run required a denied write-capable open.

The **five things I would fix before the next release**, in order:

1. Repair eval replay and test the actual workflow helper.
2. Make the gate credential-free and genuinely offline.
3. Require that gate plus runtime checks for all four release targets.
4. Make npm packing rebuild reliably and test the installed tarball’s `tui` and `-p`.
5. Unify writable-state handling and protect settings creation and diagnostic files.