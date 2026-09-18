# TUI Feature Parity Matrix

Every user-visible TUI feature, its source of truth, and its verification status.
Status legend: **inherited** = shipped by the upstream seed; **fork** = our change.
Verification: T1 logic / T2 render-snapshot / T3 pty-e2e / V visual-PNG / — not yet.

The fork ships the moment every row is at least inherited **and** every row marked
"gate" is covered by T3 (and V where visual). Until then `vendor/zcode-tui-index.js`
remains the build overlay.

## 1. TUI-local slash commands (dispatch in `index.ts` submit)

| Command | Behavior | Status | Verify |
|---|---|---|---|
| `/exit`, `/quit` | stop; exit summary (usage + resume hint) | inherited | gate: T3 (exit 0) |
| `/cls` | clear visible transcript projection | inherited | T3 |
| `/search <t>\|next\|prev\|clear` | transcript search | inherited | gate: T3 + T2 |
| `/transcript next\|prev\|latest\|close` | navigate/expand blocks | inherited | T3 |
| `/copy` | copy selection or last response | inherited | T3 |
| `/paste-image` | clipboard image attach | inherited | T3 (mock clipboard) |
| `/attachments [list\|clear]` | pending attachment bar | inherited | T2 |
| `/activity` | active tools/tasks panel | inherited | T3 |
| `/tasks [list\|stop\|message\|resume]` | background task center | inherited | T3 |
| `/diff` | workspace + per-turn diff browser | inherited | gate: T3 + V |
| `/context` | context pressure/cache panel | inherited | T3 + V |
| `/status` | versions/model/mode/branch/todos panel | inherited | gate: T3 (done) + V |
| `/rename <title>` | persist custom session title | inherited | T3 |
| `/config`, `/settings` | settings loop (notify, display, copy) | inherited | gate: T3 |
| `/setup` | first-run wizard | inherited | T3 |
| `/plan [on\|off]` | plan mode toggle | inherited | T3 |
| `/mode [build\|edit\|yolo]` | permission mode | inherited | T3 |
| `/model [list\|p/m]` | picker / transient switch | inherited | gate: T3 + T2 |
| `/effort`, `/variant` | reasoning effort picker | inherited | T3 |
| `/mcp [list]` | MCP server picker/connect | inherited | T3 |
| `/login` | suspends TUI, runs login child | inherited | T3 (env-injected cmd) |
| runtime passthrough | `/help /compact /init /expert /workflow(s) /fork /locale /plugins /new /resume /rewind /skill /goal` | inherited | gate: `/help` T3 (done); rest T3 spot |

## 2. Keybindings

| Binding | Action | Status | Verify |
|---|---|---|---|
| enter / shift+enter / ctrl+j | submit / newline | inherited | gate: T3 (submit done) |
| tab (turn+text) / tab (empty) | queue follow-up / cycle effort | inherited | T3 |
| shift+tab | cycle build→edit→yolo | inherited | T3 |
| ctrl+n | cycle model (session-only) | inherited | T3 |
| ctrl+c / ctrl+d | clear→abort→exit / exit | inherited | gate: T3 |
| escape / double-escape | close panel → interrupt → rewind hint | inherited | gate: T3 |
| ctrl+o | toggle transcript expansion | inherited | T3 |
| ctrl+f | prefill `/search ` | inherited | T2 |
| alt+up / shift+left | edit latest queued input | inherited | T3 |
| pageUp/pageDown | scroll transcript | inherited | T3 |
| ctrl+v | attach clipboard image | inherited | T3 (mock) |
| n / N | search next/prev (empty editor) | inherited | T3 |
| pi-tui editor set | emacs bindings, kill-ring, undo, jump-chars | inherited (pi-tui) | T2 sample |
| pi-tui alt-screen set | paging, ctrl+up/down jumps, ctrl+shift+f search | inherited (pi-tui) | T3 fullscreen |

## 3. Visual / interactive features

| Feature | Source | Status | Verify |
|---|---|---|---|
| Welcome banner + hints | `welcome-banner.ts` | inherited | gate: T3 (done) + V |
| Regular mode (scrollback) | `tui-mode.ts`, pi-tui main screen | inherited | gate: T3 (done) |
| Fullscreen mode | pi-tui alt screen + `fullscreen-header.ts` | inherited | gate: T3 + V |
| Statusline segments | `status-line.ts` | inherited | T2 + V |
| Footer activity/timing | `footer-bar.ts` | inherited | T2 |
| Themes dark/light/auto + detection | `theme.ts`, `color-scheme.ts` | inherited | gate: T2 (responder) + V both themes |
| Markdown rendering | `rich-markdown.ts`, `code-highlighter.ts` | inherited | T2 + V |
| Diff views (per-turn, workspace) | `file-diff-view.ts`, `workspace-diff.ts`, `turn-diff-store.ts` | inherited | T3 + V |
| Tool renderers (6 families) | `tool-renderers/*`, `tool-view.ts` | inherited | T2 + V |
| Streaming assistant text | `assistant-stream.ts` | inherited | gate: T3 (done) |
| Thinking view | `thinking-view.ts` | inherited | T3 (mock) |
| Input queue / steering | `input-queue.ts`, `queued-input-view.ts` | inherited | T3 |
| Plan editor/panel | `plan-editor.ts`, `plan-view.ts` | inherited | T3 |
| Rewind flow | `rewind.ts` | inherited | gate: T3 |
| Notifications | `notifications.ts` | inherited | T3 (env-controlled) |
| Images (kitty/iTerm2 + clipboard) | pi-tui Image, `attachment-bar.ts` | inherited | V (fallback) |
| Autocomplete (slash, @, $) | pi-tui + `workspace-autocomplete.ts` | inherited | T2 + T3 |
| Skills catalog | `skills.ts` | inherited | T2 |
| Session title / rename | `session-title.ts` | inherited | T3 |
| Mouse (fullscreen) | pi-tui MouseRegion + scrollbar | inherited | T3 (SGR injection) |
| Search UI | pi-tui alt-screen-search | inherited | gate: T3 |
| Exit summary | `exit-summary.ts` | inherited | T3 |
| Update banner | `update-available-view.ts` | inherited (disabled via env in tests) | T2 |
| zh-CN locale strings | core + TUI locale files | inherited | T3 spot |

## 4. Fork changes ledger

Upstream seed = `b8d8e95`. Any intentional deviation lands here with a `// [fork]`
marker in code.

| Change | Reason | Verified by |
|---|---|---|
| `TuiOptions.terminal?: Terminal` seam + TTY-gate bypass | whole-app in-process testing (both external reviews demanded it) | `test/tui-render/whole-app.test.ts` (4 tests) |
| `src/cli/` vendored helpers with rewritten imports | upstream imported them from its monorepo root | builds + full suite |
| deps `beautiful-mermaid`, `cli-highlight`, `diff` added | upstream HEAD uses them; were bundled in the old vendor build | build green |

## 5. Gate rule

`scripts/gate.sh` fails unless: build overlays `packages/tui/dist/index.js`; T1–T3
green; all "gate" rows above green; visual PNG set reviewed by judge for the V rows.
