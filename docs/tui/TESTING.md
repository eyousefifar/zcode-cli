# TUI Testing — three tiers plus a visual gate

Companions: [ARCHITECTURE.md](./ARCHITECTURE.md) · [PARITY.md](./PARITY.md) ·
[RESEARCH.md](./RESEARCH.md)

Pattern (converged by openai/codex, pi-tui, opencode): **drive the real renderer →
parse ANSI with a virtual terminal → assert on the screen buffer → snapshot strings;
render the same captures to PNG for human/judge visual review.**

What exists today:

| Tier | Location | Count | What it covers |
|---|---|---|---|
| T1 logic | `test/tui-unit/logic.test.ts` | 19 tests | `normalizeEvent` (nesting/aliases/tool kinds), statusline degradation, theme palette surface, markdown segmentation |
| T2 whole-app in-process | `test/tui-render/whole-app.test.ts` | 4 tests | boots the real `ZCodeTui` through the `[fork]` terminal seam against `VirtualTerminal`, streams a stubbed turn, dark/light theme determinism (cell-fg signatures), `/status` panel |
| T3 pty e2e | `test/tui.e2e.test.ts` + `test/headless.e2e.test.ts` | 21 tests | compiled binary under `Bun.Terminal`, mock model server, strengthened panel assertions (unique strings, double-Enter autocomplete semantics) |
| Visual gate | `scripts/tui-shot.ts` → `artifacts/tui/*.png` | 6 scenarios | boot dark/light, /help, /status panel, markdown turn, fullscreen — judge-reviewed PNGs |

Harness facts that took real debugging to learn (encoded in the helpers, don't undo):

- **ONLCR**: a real pty's termios translates `\n`→`\r\n`; `VirtualTerminal.write` must
  replicate that or every rendered line drifts (`test/helpers/tui-virtual.ts`).
- **Terminal queries**: pi-tui probes OSC 11 (`\x1b]11;?\x07`, BEL-terminated), DSR
  `\x1b[?996n`, and kitty/DA1 `\x1b[?u\x1b[c`. Both the pty master
  (`startTui({respondQueries})`) and `VirtualTerminal` can answer; DSR replies
  `\x1b[?997;1n`=dark / `\x1b[?997;2n`=light (per pi-tui's parser).
- **Autocomplete Enter semantics**: with the command palette popup open, the first
  Enter accepts the completion; a second Enter submits. Tests type
  command → pause → `\r` → pause → `\r`. Assertion strings must be unique panel
  content, never popup text (the original `/status` regex was a false pass).
- **Cell reads race the parser**: `TerminalScreen` parses pty bytes asynchronously;
  `cells()` awaits `settled()` before reading, `cellsNow()` is the deliberate
  no-wait variant for transient panels.
- **The /status panel is transient on screen**: it re-renders and closes on the next
  tick — capture cells at the instant the wait resolves (`transient: true` in
  tui-shot scenarios).
- **PNG serialization**: cells → styled HTML (`white-space: pre`) → headless Chrome
  `--screenshot`. Row divs must be joined with NO whitespace and pinned to
  `height:18px; line-height:18px` — an inter-div newline inside `white-space:pre`
  doubles every row height and silently pushes the statusline out of the frame.

## Tier 1 — logic tests

`bun test test/tui-unit/` — pure functions, no renderer: add cases next to the module
when fixing bugs in `events.ts`, `status-line.ts`, segmentation, themes.

## Tier 2 — whole-app in-process

`bun test test/tui-render/` — `runTui({ terminal, ...stubAdapter })` with
`VirtualTerminal` (pi-tui `Terminal` iface over `@xterm/headless` + query responder).
Environment is self-contained: temp `HOME`, `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
fixture with an `account:` selection (passes the coding-plan gate without real
credentials). Component-level snapshot tests slot in here too.

## Tier 3 — e2e against the compiled binary

`bun test test/tui.e2e.test.ts` (pty) — offline sandbox + mock server, respawned per
run. Next scenarios to add (review backlog): fullscreen flows, resize mid-turn, mouse
SGR injection, search n/N, rewind double-Esc, `/login` suspension with
`ZCODE_TUI_LOGIN_CMD`, zh-CN spot checks, tool-call + permission dialog flows via the
mock server.

## Visual gate — `scripts/tui-shot.ts`

`bun scripts/tui-shot.ts [scenario…]` — per scenario: fresh sandbox + binary in a pty
→ scripted keystrokes → `@xterm/headless` buffer → styled HTML → headless Chrome PNG
in `artifacts/tui/` (plus `.txt` screen dumps and `manifest.json`). Judge-agent review
of the PNG set is the visual acceptance pass; humans can open the same files. GIFs
optional later (`brew install vhs` — ask first).

## Gate wiring

`scripts/gate.sh`: build (fork overlay + native + npm) → `bun test test/` (T1+T2+T3)
→ npm-entry smoke → optional `RUN_VISUAL=1` runs tui-shot + judge → optional
`RUN_ONLINE=1` flag matrix → perf smoke.
