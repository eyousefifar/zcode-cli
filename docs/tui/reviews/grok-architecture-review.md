I'll review the four planning docs against the current TUI, tests, and overlay path, then rank concrete risks and gaps.I’ll inspect the overlay, contract, and current tests so the review is grounded in what actually ships.The leftover review file is incomplete; next I’ll inspect the TUI contract, CLI helpers, and overlay to find real risks.The plan is directionally right — stay on pi-tui, seed from MIT source, three-tier tests, vendor as fallback — but it currently treats **inherited** as proven and **Tier 2** as already possible. Neither is true in this tree. `scripts/build.sh` already overlays `packages/tui/dist/index.js` whenever that file exists, while `PARITY.md` still says the vendor artifact stays until the gate is green.

## Top 5

### 1. Make the terminal injectable — otherwise Tier 2 is fiction

Codex’s `VT100Backend` wraps the *real* backend. Bubble Tea’s `WithInput` / `WithOutput` does the same. This plan assumes `ZCodeTui` can be driven through a `VirtualTerminal`. It cannot.

`createTui()` always constructs `NotifyingProcessTerminal` (hardcoded `ProcessTerminal`). `run()` then bails unless `process.stdin.isTTY && process.stdout.isTTY`. `TuiOptions.stdin` / `stdout` are only used for OSC titles and the exit summary.

pi-tui 0.85.1 does **not** export the `VirtualTerminal` the README mentions — only `ProcessTerminal`. RESEARCH.md §2.2 overstates that. You have to write the adapter (your `test/helpers/terminal-screen.ts` is a parser, not a `Terminal`).

**Do this as the first `// [fork]` row:** `TuiOptions.terminal?: Terminal`, skip the TTY check when it is set, and answer OSC 11 / DA1 / kitty / DSR 996 on that object. That single seam is what makes deterministic theme tests, permission-dialog snapshots, and in-process slash dispatch possible. Without it, every “T2” row in the matrix is really “T3 or nothing.”

### 2. Dual-run golden vs the vendor overlay *before* flipping the ship path

The matrix marks almost everything **inherited**. That is a provenance claim, not a proof. The seed is a *superset* of the old bundle (HEAD `b8d8e95` includes scrollbar-drag #159). A superset can still look wrong against this core: event aliases, capability-detected callbacks, the session-event bridge.

Meanwhile the ship path has already flipped:

```21:26:scripts/build.sh
if [[ -f packages/tui/dist/index.js ]]; then
  cp packages/tui/dist/index.js node_modules/@zcode/tui/dist/index.js
  echo "TUI: bundling fork packages/tui (our build)"
elif [[ -f vendor/zcode-tui-index.js ]]; then
```

`build.sh` also only rebuilds the TUI if `dist/index.js` is *missing*, not if `src/` is newer.

**Parity gate that actually works:** same keyscript, same mock server, two overlays (`packages/tui/dist` vs `vendor/zcode-tui-index.js`), diff `@xterm/headless` `screenText()` (and SGR cell dumps for V rows). Fail on a textual diff; PNGs are for humans. Keep an explicit `TUI_OVERLAY=vendor|fork` switch until that harness is green. This is the one technique Codex/OpenCode never needed, and the one this fork cannot skip.

The core only consumes `runTui` (`r.runTui ?? (await loadTuiRuntime()).runTui`). Still freeze the *outgoing* named exports (`runTui`, `loginFailureDiagnostic`, `shouldSuspendForLoginCommand`, …) with a one-file contract test — they are part of the published module even if the core ignores them today.

### 3. Test the agent loop, not the chrome — mock server must emit tools and permissions

Today’s T3 (`test/tui.e2e.test.ts`) is five tests: boot, text sentinel, `/status` regex, `/help` regex, `/exit 0`. `model-server.ts` only streams assistant text. It never emits `tool_call_*`, never calls `requestPermission`, never exercises `choice-dialog.ts` (695 lines) or the permission queue.

That is the product. An agent TUI that cannot be shown to approve a write, reject a bash, or render a streaming tool card is not at parity.

**Minimum T3 additions, all gated:**

| Scenario | Why it is a hole |
|---|---|
| Mock `tool_call_scheduled → started → result` for a write | tool-renderer + transcript + `/activity` |
| `requestPermission` → choose Allow/Deny | `choice-dialog` + mode `build/edit/yolo` |
| Mid-turn interrupt (Esc) then rewind hint (double-Esc) | abort + `previewFileRewind` |
| Steer via Tab-queued input while a turn is live | `input-queue` state machine |
| Resize mid-stream (`terminal.resize`) | statusline reflow, markdown wrap |

Also: `installCredentials()` copies `$HOME/.zcode-standalone/.../credentials.json`. T3 currently requires a developer machine’s encrypted login. Fabricate sandbox credentials from the mock provider fixture so CI can run without a real account.

PTY query-responder belongs on the *master* in `tui-session.ts`, not only in Tier 2. Theme, kitty keyboard, and DA1 always time out in e2e today; TESTING.md already admits this.

### 4. Split `index.ts` along Bubble Tea lines *before* performance/UX work

`packages/tui/src/index.ts` is 5,741 lines: composition root, slash dispatch, permission UI, login suspend, mode switch, statusline, signal handling. RESEARCH.md correctly copies OpenCode’s “logic tests with a stubbed renderer,” but the state is not extractable.

Steal Bubble Tea’s split, not its renderer:

- **Model** — mode, plan flag, queue, permission queue, transcript cursor, tuiMode
- **Msg** — normalized `StreamEvent`, key, resize, picker result
- **View** — already mostly in the leaf modules

Highest-ROI T1 files are already listed and actually unit-testable today: `events.ts` (`normalizeEvent`), `input-queue.ts`, `status-line.ts`, `turn-diff-store.ts`, `bounded-tool-text.ts`, `color-scheme.ts`. Add `permission-request-queue.ts` and a pure slash-dispatch table extracted from `index.ts`. Do **not** start with full-app snapshots of `ZCodeTui`.

Codex’s `styles.md` is the other steal: a one-page visual contract (statusline order, diff colors, permission chrome) that T2 snapshots assert against. The matrix currently has no style source of truth.

### 5. Assert on the cell buffer; treat Chrome/judge as review, not gate — and put mermaid/ELK on a size budget

TESTING.md’s visual pipeline (pty bytes → xterm → HTML → hardcoded macOS Chrome → judge-agent) will flake and will not measure the terminal:

- Headless Chrome screenshots the *serializer’s* font metrics, not the user’s terminal.
- `"/Applications/Google Chrome.app/..."` is not a CI path.
- A judge-agent on PNGs is non-deterministic. Codex uses `vt100::Parser` + `screen().contents()` + insta; OpenTUI uses renderer `.snap` files. Follow them. PNG/VHS is a human/demo artifact (`RUN_VISUAL=1`), never `scripts/gate.sh`.

`packages/tui/dist/index.js` is already 3.1 MB and embeds ELK (via `beautiful-mermaid`). Mermaid is not in the parity matrix at all. highlight.js lazy-load is backlog, but mermaid/ELK is the silent binary-size regression versus the 4.7 MB vendor file (which bundled ~190 highlight.js languages instead). Pick one heavyweight and gate it: either mermaid is a V-row with a size budget, or it is lazy-loaded behind a fence.

`scripts/gate.sh` still does not implement TESTING.md (no T1/T2/T3 split, no visual, no overlay check). Wire the docs to the script or the docs are aspirational.

---

## Missed risks (after the top 5)

**Two settings writers.** `packages/tui/src/cli/` was vendored because upstream TUI imported monorepo CLI helpers. `cliSettingsPath()` is `$HOME/.zcode/cli/setting.json` and ignores `ZCODE_DATA_BASE_DIR` except for provider config. The standalone shim isolates credentials under `~/.zcode-standalone`. `/config`, `/setup`, tuiMode persistence, copy-on-select, and notifications will write into the *desktop* settings tree. Document this as a fork invariant or re-root those helpers.

**Update check is the wrong product.** `UPDATE_CHECK_URL = "https://registry.npmjs.org/zcode-app-cli/latest"`. That is kingsword09’s package. On a fork this is a user-visible lie and a network call. Disable by default (tests already set `ZCODE_DISABLE_UPDATE_CHECK=1`) and add a PARITY ledger row.

**Native addons + Linux.** pi-tui only ships darwin/win32 `.node` prebuilds (width/ANSI + CoreGraphics images). `getNativeModuleCandidates()` looks next to `process.execPath` — correct for `bun build --compile` *if* you copy the addon beside the binary. `build.ts` does not. Linux image fallback is untested. RESEARCH.md’s “N-API prebuilds embeddable” is true only after the compile step copies them.

**Login suspend is a terminal-state minefield.** `/login` does `ui.stop()` then `spawn(..., stdio: inherit)` then `ui.start()`. T3 “env-injected cmd” is the right idea (`ZCODE_TUI_LOGIN_CMD` exists). Assert alt-screen restore, raw mode, and mouse/focus modes after the child exits — this is the classic leak Bubble Tea/`suspendTerminal` exist to prevent.

**Crash restore.** Stream-error guards exist; uncaught exceptions still skip `ui.stop()`. One `process.on("uncaughtException")` that restores the terminal is worth more than a visual polish item.

**LICENSE-NOTE is stale.** Section 2 still describes `vendor/zcode-tui-index.js` as the TUI. `packages/tui/` is now the source, including rewritten `src/cli/`. Attribution and the overlay story need a pass before ship.

**xterm version skew.** Root pins `@xterm/headless@6.0.0`; pi-tui’s own tests used 5.5. Parser differences will show up as snapshot noise, not product bugs.

**Windows.** `Bun.Terminal` is POSIX-only (bun#25593). Every T3 row is macOS/Linux. Call that out as an explicit non-goal or the matrix over-promises.

---

## Testing-plan holes

| Hole | Detail |
|---|---|
| Gate script ≠ TESTING.md | `gate.sh` is still build → `bun test test/` → npm smoke → optional online → perf |
| No T1/T2 directories | `test/tui-unit/` and `test/tui-render/` do not exist |
| T3 assertions are weak | `/status` waits for `/Status\|Session\|Model/i` — that can match the welcome screen |
| `Bun.sleep(500)` | Replace with screen predicates; this is how the suite will flake |
| No query responder on the PTY master | Theme/kitty/DA1 always take the timeout path in e2e |
| No CSI 2026 / flicker test | pi-tui’s whole rendering thesis is untested |
| No CJK / wide-char cases | Backlog item, but editor + markdown tables + statusline truncation are where they break |
| No `noColor` / `TERM=dumb` | `TuiOptions.noColor` is in the contract |
| Mouse = wheel only | Seed commit is *draggable scrollbar*. Inject SGR press/drag/release, not just `\e[<64;…M` |
| Images | Kitty/iTerm2 will never round-trip through xterm-headless; assert the *fallback* text, and mark V as “human only” |
| Locale | “zh-CN spot” is not a snapshot of TUI-owned strings (welcome, shortcuts, panels) |
| Perf budgets have no harness | “first keystroke &lt; 16 ms”, “coalesce ≤ 8 ms”, “markdown cache &gt; 90%” are unmeasured; `perf.sh` times `--version` and a live API turn |
| Snapshot hygiene | Full-screen text snaps will churn on version strings (`ZCODE v0.16.5` is already hardcoded in e2e). Mask version, timer, spinner |

Codex’s pattern that is missing here: **colocated snapshots per surface** (`welcome`, `permission`, `diff`, `statusline`) rather than one giant screen dump per scenario.

---

## Parity-matrix gaps

User-visible and missing or under-gated:

- **Permission / choice dialogs** (`choice-dialog.ts`, `permission-view.ts`) — the main interactive surface; not a gate
- **Mermaid fences** (`rich-markdown.ts` + ELK) — heavy and unlisted
- **Ask-user-question / ExitPlanMode tools** (`interactions.ts`)
- **Workflow panel** (`subscribeWorkflowEvents`, `/workflow`)
- **Goal rail** (`goal-status.ts`)
- **Tool group/tree views**
- **Protocol parts**
- **Copy-on-select + `/copy` of selection vs last response** (two behaviors)
- **Bracketed paste, kill-ring, undo** — “T2 sample” is too thin for the editor
- **Login suspend/resume** (modes restored)
- **Regular ↔ fullscreen switch mid-session** (`switchTuiMode`, blocked during a turn)
- **OSC 9 / BEL / native notifier + focus reporting** (`?1004h`)
- **OSC 133** (pi-tui prompt markers / shell integration)
- **Synchronized output CSI 2026**
- **Scrollbar drag** (the seed commit)
- **Click-to-position in editor**
- **`noColor`, narrow widths (statusline degradation is T1-worthy and is not gated)**
- **Capability-absent core** — the whole “degrade to unavailable” story has no row; run T2 against an adapter that only implements `submitPrompt`
- **Named export surface** (see #2)
- **`src/cli/` side effects** (settings, update check, model-access preflight)

Slash “runtime passthrough” as one row is too coarse. `/rewind`, `/compact`, `/fork`, `/skill` each have distinct UI. Spot-check is how regressions will land.

Keybinding table misses ctrl+c *state machine* (clear → abort → exit) as three assertions, not one.

---

## Worth stealing (and not)

| Source | Steal | Do not steal |
|---|---|---|
| **Codex / ratatui** | Wrap the real backend; snapshot `screen().contents()`; per-surface snaps; `styles.md` | Rust, insta specifically |
| **Bubble Tea** | `WithInput`/`WithOutput`; Model/Update/View; panic-restore of alt screen; typed `MouseMsg` | Go, FSL Crush code |
| **OpenCode / OpenTUI** | Stubbed-renderer unit tests; later: palette, leader key, `diff_style`, `@` fuzzy mentions | Zig FFI renderer (`bun build --compile` cannot embed those dylibs — correctly rejected) |
| **Ink** | `suspendTerminal()` semantics for `/login`; `usePaste` as a test of bracketed paste | React/Yoga |
| **pi-tui itself** | Query APIs already on `TUI` (`queryTerminalBackgroundColor`, `queryTerminalColorScheme`); CSI 2026; `drainInput` on exit | The README’s non-exported `VirtualTerminal` |

One OpenCode idea I would pull *forward* from “later”: **keybind names as data**. pi-tui already has a 46-binding registry with overrides. Exposing that as a small `tui.json` (or a `/config` page) is cheaper than a command palette and unblocks users who hit ctrl+c / Esc muscle memory from Codex or OpenCode.

---

## What is already solid

- Fork-and-own from MIT HEAD instead of de-minifying the 4.94 MB bundle.
- Staying on pi-tui (ANSI-string, two-tree, test-shaped `Terminal` interface).
- Capability-detected `RuntimeAdapter` (matches how this core actually works).
- `Bun.Terminal` + `@xterm/headless` as the e2e stack; avoiding `node-pty`.
- Performance-before-palette-before-config as the post-parity order.
- Event normalization as the core↔TUI shock absorber.

If you only take one change before writing more plan: **inject `Terminal`, dual-run against vendor, and put permission+tool cards on the mock server.** Everything else in these four docs becomes testable after that.
