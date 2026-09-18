# TUI Architecture — the fork we own, and how it talks to the core

Status: v1 (2026-09-18). Companions: [RESEARCH.md](./RESEARCH.md),
[PARITY.md](./PARITY.md), [TESTING.md](./TESTING.md).

## 1. System context

```
~/.local/bin/zcode  (bun --compile single binary)
 └─ src/entry.ts shim (argv/USER/homedir hardening, env bootstrap)
     └─ vendor/zcode.cjs   (proprietary ZCode core, 11.4 MB, CJS)
         ├─ default command: "tui"
         ├─ loads @zcode/tui  →  node_modules/@zcode/tui/dist/index.js
         │    (build-time overlay: OUR packages/tui build, was vendor/zcode-tui-index.js)
         │    └─ @earendil-works/pi-tui (external, installed in node_modules)
         ├─ builds RuntimeAdapter (all capability callbacks) + slashCommands registry
         └─ runTui(adapter + TuiOptions)
```

At build time, `scripts/build.sh` overlays `packages/tui/dist/index.js` onto
`node_modules/@zcode/tui/dist/index.js`; `build.ts` then bundles everything into the
binary. The TUI never talks to a second process for chat — it receives the core's
callbacks directly and renders to the inherited terminal.

## 2. Fork provenance

- Seeded from kingsword09/zcode-cli `packages/zcode-tui/src` at commit `b8d8e95`
  ("fix(tui): restore draggable fullscreen scrollbar (#159)", 2026-09-18), MIT
  ("zcode-app-cli contributors"), 78 files / ~21.5k lines (plus `index.ts` 5.7k).
- Proven a strict superset of our previous vendor bundle by region inventory + symbol
  search (see RESEARCH.md §1).
- Our fork lives in `packages/tui/` (built to `dist/index.js`, pi-tui external).
  Deviations from upstream get `// [fork]` comments and a row in PARITY.md.
- Attribution: repo-root `LICENSE` (MIT) + `LICENSE-NOTE` section 2.

## 3. Module map (packages/tui/src)

Grouped by responsibility; line counts from upstream seed.

**Entry / shell**
| Module | Lines | Role |
|---|---|---|
| `index.ts` | 5741 | `ZCodeTui` class + `runTui()`: composition root, screen setup (regular/fullscreen), submit flow, slash dispatch (TUI-local commands), key handling, statusline updates, exit summary |
| `types.ts` | 151 | `RuntimeAdapter`, `TuiOptions`, `PromptCallOptions`, `SlashCommandOption` — the whole core↔TUI contract |
| `tui-mode.ts` | 48 | regular vs fullscreen resolution (`ZCODE_TUI_MODE` env > `ui.tuiMode` setting > regular) |
| `welcome-banner.ts` | 163 | "Ask a task about this workspace" box, hints, fullscreen header transition |
| `fullscreen-header.ts` | 241 | fullscreen header: workspace path (~/-shortened), git branch, model |
| `update-available-view.ts` | 23 | update banner block |
| `stream-error-guard.ts` | 19 | guards on stdout/stderr death |

**Rendering core**
| Module | Lines | Role |
|---|---|---|
| `transcript.ts` | 526 | transcript model: blocks, expansion states, projection to components |
| `renderable.ts` | 36 | minimal renderable-component interface glue |
| `terminal-text.ts` | 231 | ANSI-safe text ops on top of pi-tui utils |
| `rich-markdown.ts` | 3542 | marked + parse5 + highlight.js pipeline → themed ANSI; tables, code, task lists |
| `code-highlighter.ts` | 722 | highlight.js integration behind the Markdown `highlightCode` hook, per-theme colors |
| `theme.ts` | 204 | dark/light palettes (accent/success/warning/error/diff pairs/scrollbar/search-match), `themePreference auto\|dark\|light` |
| `color-scheme.ts` | 42 | OSC 11 + DSR `\e[?996n` detection with timeouts, COLORFGBG fallback |
| `status-line.ts` | 69 | statusline composition (see §6) |
| `footer-bar.ts` | 46 | left activity text + right timing |
| `panels.ts` | 148 | modal panel scaffolding for /status, /context, /diff… |

**Turn / streaming**
| Module | Lines | Role |
|---|---|---|
| `events.ts` | 515 | `normalizeEvent`: tolerates payload/event/streamEvent nesting, id aliases, tool lifecycle events, model network events |
| `assistant-stream.ts` | 127 | segmented upsert of streaming assistant text |
| `thinking-view.ts` | 184 | reasoning/thought rendering |
| `tool-view.ts` | 567 | tool call rendering dispatch |
| `tool-payload.ts` | 237 | tool payload parsing/normalization |
| `turn-presentation-registry.ts` | 64 | per-turn presentation rules |
| `turn-work-tracker.ts` | 114 | work items, durations |
| `turn-status.ts` | 47 | turn state machine view |
| `work-duration-view.ts` | 33 | durations in footer |
| `runtime-projection.ts` | 419 | projection of runtime state (active tools, turn ids) |
| `runtime-activity-view.ts` | 132 | /activity panel |
| `runtime-poll.ts` | 41 | polling fallbacks |
| `system-event-view.ts` | 61 | system event blocks |

**Tool renderers** (`tool-renderers/`): `registry.ts` (78), `helpers.ts` (169),
`filesystem.ts` (70), `execution.ts` (273), `workflow.ts` (118), `interaction.ts` (79),
`web.ts` (109), `index.ts` (63), `types.ts` (73) — per-family rendering of tool calls;
`tool-group-view.ts` (88) + `tool-tree-view.ts` (92) group/tree presentation;
`bounded-tool-text.ts` (196) caps output size.

**Diffs & rewind**
`file-diff-view.ts` (495), `file-diff-budget.ts` (171), `diff-browser.ts` (93),
`workspace-diff.ts` (226), `turn-diff-store.ts` (114) — per-turn snapshots + live
workspace diff, paged browser; `rewind.ts` (97) — double-Esc checkpoint flow via
`previewFileRewind`/`applyFileRewind`.

**Input / composer**
`input-queue.ts` (320) + `queued-input-view.ts` (77) — queue during turn, steer active
turn; `plan-editor.ts` (25) + `plan-view.ts` (132) — plan mode composer/panel;
`attachments.ts` (42) + `attachment-bar.ts` (159) — pending image bar;
`selection-command.ts` (118) — /copy of selection; `shortcuts.ts` (51) — keybinding
labels for /help; `prompt-preflight.ts` (25) — pre-submit gates (login check).

**Completion / context**
`workspace-autocomplete.ts` (256) — `@` paths + plugin refs + `$skills`;
`skills.ts` (168) — SkillCatalog with 2 s cache; `plugin-references.ts` (159);
`context-status-view.ts` (337), `context-breakdown.ts` (57), `context-cache.ts` (193) —
/context panel; `selectors.ts` (138) — derived state helpers.

**Sessions / notifications / misc**
`session-title.ts` (45) — first-message title + custom titles; `session-status.ts` (81)
— /status panel; `exit-summary.ts` (71) — token usage + resume hint; `copy-on-select.ts`
(30); `notifications.ts` (418) — OSC 9 / BEL / native notifier, unfocused/always;
`background-task-events.ts` (368) + `background-task-output.ts` (38) — /tasks center;
`interactions.ts` (160) + `choice-dialog.ts` (695) + `permission-view.ts` (86) +
`permission-request-queue.ts` (14) — permission prompts; `goal-status.ts` (68);
`protocol-part-view.ts` (107).

## 4. The core↔TUI contract (`types.ts`, verbatim semantics)

`runTui(options: TuiOptions)` where

```ts
interface TuiOptions extends RuntimeAdapter {
  initialMode?: string; initialPlanEnabled?: boolean; initialModel?: unknown;
  initialThoughtLevel?: string; initialTuiMode?: "regular" | "fullscreen";
  terminal?: Terminal;               // [fork] injected pi-tui Terminal (tests/embedding);
                                     // set ⇒ the process-TTY gate is skipped
  loginRequired?: boolean; locale?: string; theme?: string; developerMode?: boolean;
  version?: string; workspaceDirectory?: string; workspaceGitBranch?: string;
  noColor?: boolean; effortOptions?: unknown[]; modelOptions?: unknown[];
  slashCommands?: SlashCommandOption[];          // runtime registry passthrough
  stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream;
  listWorkspacePathSuggestions?: ListWorkspacePathSuggestions;
  writeClipboardText?: (text: string) => Promise<void>;
  readClipboardImage?: (options?) => Promise<unknown>;
}

interface RuntimeAdapter {          // ALL optional except submitPrompt
  submitPrompt: (input, options: PromptCallOptions) => Promise<unknown>;
  sendInput?, promoteQueuedInput?, interruptTurn?,
  subscribeSessionEvents?,           // (kingsword09 bridge addition to the core)
  loadSessionTranscript?, loadSessionContextMessages?,
  listModelOptions?, readDefaultModel?, setDefaultModel?, reloadModelOptions?,
  setTransientModel?, readSessionModel?, recallPreviousInput?,
  readGoal?, readTodos?, readRuntimeProjection?, readSessionUsage?,
  cancelBackgroundTask?, sendBackgroundTaskMessage?,
  previewFileRewind?, applyFileRewind?,
  setMode?, setPlanEnabled?, readExecutionState?, listMcpServers?,
  setCustomSessionTitle?, readCustomSessionTitle?,
  listSkills?, listPluginReferences?,
  refreshWorkflowPanel?, stopWorkflow?, subscribeWorkflowEvents?,
}
```

Every callback is capability-detected: absent features degrade to
"unavailable in this runtime" notices instead of crashing — this is what lets the TUI
run against cores with or without the session-event bridge.

**Turn flow:** `submitPrompt(input, {abortSignal, delivery: "auto"|"start_turn"|
"steer_active_turn", queueDelivery: "guide"|"queue", inputId, queryId, onEvent,
requestPermission})` streams synchronous events via `onEvent`; everything else arrives
asynchronously through `subscribeSessionEvents(listener)` → unsubscribe fn. `events.ts`
normalizes both into one envelope shape (aliases: `payload`/`event`/`streamEvent`
nesting, `messageId|messageID|assistantMessageID`, `sessionId|sessionID`, tool
`tool_call_scheduled/started/progress/result/error/closed`, model
`model_request_started/completed/failed`, `model_retry_scheduled`,
`model_stream_stalled`).

## 5. Rendering model

- **regular mode**: pi-tui `TuiMainScreen` — components render to ANSI lines appended to
  the terminal's own scrollback; composer stays at the bottom; differential redraw of
  the live region only.
- **fullscreen mode**: pi-tui `TuiAltScreen` — app owns scrolling; fixed composer dock;
  VStack/HStack/ScrollView layout; themed transient scrollbar; mouse (SGR 1002/1006)
  wheel = 3 lines/click, click-to-position in editor, selection + copy-on-select;
  welcome transition (180 ms).
- Theme detection (in `ZCodeTui` startup, not `color-scheme.ts`): OSC 11 background
  query and DSR `\e[?996n` color-scheme report are probed **concurrently**
  (`Promise.all`, OSC preferred on conflict), each with 100 ms timeouts; COLORFGBG →
  dark as the fallback when both time out.
- Synchronized output (CSI 2026) wraps frames; flicker-free on supporting terminals.

## 6. Statusline (segments)

`◈ model` · `◉ mode` · `⚡ effort` · `ctx N% left` (error ≤10%, warn ≤20%) ·
`cache N% hit` · `session N tokens` · `N in background` · `find i/n: query` ·
`message i/n · kind` · `expanded` — degraded gracefully at narrow widths. Note:
display order (left→right) is not the retention priority — `status-line.ts` drops
lowest-`priority` fields first when narrow, and search/cursor fields carry the highest
retention priority (95) so they survive where model/effort do not.

## 7. Testing architecture (3 tiers + visual gate)

Details in [TESTING.md](./TESTING.md); summary:

1. **Tier 1 — logic**: pure-function tests, stubbed renderer (opencode pattern).
2. **Tier 2 — render**: components + `ZCodeTui` driven through a `VirtualTerminal`
   (pi-tui `Terminal` iface → `@xterm/headless`) **with a terminal-query responder**
   (OSC 11/DA1/kitty/996) for deterministic themes; screen-text `.snap` snapshots.
3. **Tier 3 — e2e**: compiled binary under `Bun.Terminal` pty in an offline sandbox;
   existing suite (boot/submit/status/help/exit) + extended scenarios (fullscreen,
   resize, mouse, search, rewind, pickers, locale, latency).
4. **Visual gate**: `scripts/tui-shot.ts` captures scenario screens → HTML → headless
   Chrome PNGs → judge-agent review.

## 8. Performance budget (backlog priority #1)

Baseline (measured, scripts/perf.sh): binary startup median 0.34 s; RSS ≈ 120 MB.
Targets for the fork: TUI-ready ≤ 400 ms after core handoff; first keystroke echo <
16 ms frame; streaming redraw ≤ 1 frame per SSE chunk batch (coalesce ≤ 8 ms);
highlight.js lazy-loaded per language set actually used; markdown render cache hits
> 90% during steady-state streaming; no unbounded arrays in transcript (block caps).

## 9. Improvement backlog (post-parity)

1. **Performance** (user priority): lazy highlight.js languages; markdown render cache
   tuning; diff render budget; startup profile (`bun build --bytecode` candidate).
2. **Visual polish** (user priority): opencode-style `diff_style auto|stacked`;
   statusline refinement; CJK/wide-char edge cases in editor and markdown tables;
   scrollbar drag parity (upstream #159) verified by visual tests.
3. Later (approved direction, lower priority): command palette (ctrl+p), leader key,
   theme picker, `tui.json`-style user config.
