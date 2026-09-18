# TUI Research — landscape, learnings, and decision record

Status: research complete (2026-09-18). Companion docs: [ARCHITECTURE.md](./ARCHITECTURE.md),
[PARITY.md](./PARITY.md), [TESTING.md](./TESTING.md).

## 1. What we ship today (local ground truth)

The interactive TUI of our standalone binary is `vendor/zcode-tui-index.js` (4.94 MB,
170,421 lines) — the build artifact of `packages/zcode-tui` from
[kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli) (MIT), which layers a
ZCode-specific UI onto [`@earendil-works/pi-tui`](https://github.com/earendil-works/pi)
0.85.1 (MIT, Mario Zechner / earendil-works).

Findings from dissecting the bundle (`scripts/region-inventory.ts` →
`artifacts/tui-regions.json`):

- The bundle is **not obfuscated**: tsdown preserves `//#region <module>` markers, real
  identifiers, and comments. 318 regions total: 70 belong to `packages/zcode-tui/src/*`
  (including a 94k-line un-terminated `attachment-bar.ts` region that swallows the deps
  zone), 241 to node_modules (highlight.js core + ~190 languages, marked, parse5, jsdiff,
  chalk, cli-highlight), 7 to core-adjacent files (`app-server-client.ts`,
  `plugin-protocol.ts`).
- The bundle imports pi-tui **externally** (`from "@earendil-works/pi-tui"`), i.e. the
  overlay file is bundled into the binary together with our repo's installed pi-tui.
- Upstream repo: `packages/zcode-tui` is MIT ("zcode-app-cli contributors"), single
  runtime dependency (`@earendil-works/pi-tui 0.85.1`), 78 source files / ~21.5k lines
  of TypeScript at HEAD (commit `b8d8e95`, "fix(tui): restore draggable fullscreen
  scrollbar"), plus ~800 lines of monorepo CLI helpers it imports (`model-access`,
  `config-paths`, `app-server-client`, `plugin-protocol`, `prompt-preflight`,
  `update-check`) — we vendor those into `packages/tui/src/cli/`.
- Content fingerprints show upstream HEAD **contains** our vendored build: all 70 of
  our bundle's region-named files exist upstream, and the 8 files our bundle hides
  inside the un-marked span are present by symbol search (`SessionWelcome` ×5,
  `TurnDiffStore` ×2, `highlightCode` ×5). Lineage is established; behavior parity
  against OUR core is established by the e2e suite (44 tests), not by file matching.

**Consequence:** we do not need to de-minify anything — the real TypeScript source is
MIT-licensed and clonable. The fork (`packages/tui/`) is seeded from upstream HEAD.

## 2. Landscape study

### 2.1 OpenCode (sst/opencode → anomalyco/opencode) — primary benchmark

- TUI history: Go + Bubble Tea → full TypeScript rewrite during 2025 on **OpenTUI**,
  their own framework built for Bun.
- Stack: `@opentui/core` (Zig core loaded via Bun FFI) + `@opentui/solid` (custom
  SolidJS reconciler, fine-grained reactivity, no VDOM) + `@opentui/keymap`;
  `packages/tui` also uses `effect`, `fuzzysort`, `remeda`, `diff` (jsdiff).
- UX surface worth stealing: `@` file mentions with fuzzy search + aliases, `!` bash
  passthrough, command palette (ctrl+p), leader key ctrl+x with configurable timeout,
  session picker, model/theme pickers, `tui.json` config model (keybind merge semantics,
  scroll_speed + macOS-style scroll acceleration, `diff_style: auto|stacked`, cursor
  style/blink, mouse capture, attention/notifications with sound packs), `/editor`
  ($EDITOR) and `/export`.
- Testing: `bun test` **logic tests with a stubbed renderer** (no render snapshots in
  `packages/tui/test`); OpenTUI itself uses `bun test test/snapshot/` `.snap` files.
- License: MIT (both repos). **Borrowability verdict: steal UX patterns and small pure
  utilities, NOT the renderer** — the Zig core is dlopen'd via `bun:ffi` and
  `bun build --compile` cannot embed FFI dylibs ([oven-sh/bun#11598](https://github.com/oven-sh/bun/issues/11598)).

### 2.2 pi-tui (@earendil-works/pi-tui) — our engine (keep)

- Design doc `tui-plan.md` (in-repo): **ANSI-string surface, deliberately not a cell
  grid**; "rebuild geometry, reuse leaf lines" differential rendering; frames wrapped in
  CSI 2026 synchronized updates; two-tree model (long-lived stateful component tree vs
  per-frame transient layout tree committed atomically); `ScrollView` with
  `follow: "end"`, scroll chaining, wheel routing; OSC 133 prompt markers; exit-document
  printing.
- Component set: Text/TruncatedText, Input, Editor (kill-ring, undo, word navigation,
  bracketed paste, autocomplete providers), Markdown (marked-based, themed,
  `highlightCode` hook, render cache), Loader, SelectList/SettingsList, ScrollView,
  MouseRegion, Image (Kitty/iTerm2), Box/VStack/HStack, latex.
- Terminal abstraction: `Terminal` interface with `ProcessTerminal` (production) and a
  headless test backend over `@xterm/headless` (pi's own pattern); Kitty keyboard
  protocol; keybinding registry with 46 named bindings and user-override support.
- Native N-API prebuilds (darwin/win32) back modifier-key detection and Windows console
  input (the darwin addon links CoreGraphics for keyboard state); pi-tui resolves them
  via `createRequire` next to `process.execPath` — for `bun build --compile` the addon
  must be verified to resolve from the binary's embedded layout (our binary works on
  this machine; out-of-checkout behavior is on the test backlog).
- Verdict: **stay on pi-tui**. Proven in exactly our stack (upstream zcode-tui ships on
  it), MIT, test-backend-first design.

### 2.3 openai/codex (codex-rs/tui) — testing gold standard

- Rust + ratatui; **`VT100Backend` test harness**: wraps the real crossterm backend so
  all output flows into a `vt100::Parser`; assertions are plain
  `screen().contents()` string comparisons; snapshots colocated in `snapshots/` dirs
  (insta). Plus a per-package `styles.md` design doc.
- Lesson: full-featured agent TUI in a ~15 MB binary vs Claude Code's multi-hundred-MB
  React/Ink footprint. Keep runtime deps minimal.

### 2.4 Ink ecosystem (claude-code, gemini-cli, amp) — rejected

- Ink 7 (React 19 + Yoga WASM) works under Bun and powers Claude Code / Gemini CLI /
  Amp, but brings reconciler overhead, larger bundles, and React semantics in a
  streaming UI. Every high-performance agent TUI examined (codex, pi, OpenTUI)
  explicitly rejected VDOM-style rendering. Rejected for our fork; API ideas worth
  imitating: `usePaste` (bracketed paste), `render({alternateScreen})`,
  `suspendTerminal()`.

### 2.5 Others

| Project | Framework | License | Note |
|---|---|---|---|
| crush (charmbracelet) | Go + Bubble Tea | **FSL-1.1-MIT** | Do **not** copy code; UX inspiration only until MIT conversion |
| aider | Python + prompt_toolkit | Apache-2.0 | Proof a great agent CLI needs minimal full-screen UI |
| goose (Block → AAIF) | Rust core | Apache-2.0 | REPL-style, not a TUI-framework reference for TS |
| cursor-agent, kilocode CLI | closed/TS | — | UX benchmarks only |

## 3. TUI e2e + visual testing state of the art

The converged pattern across codex / pi / kingsword09 / OpenTUI:

1. **Drive the real renderer** (in-process component tree or the compiled binary under a
   real PTY).
2. **Parse ANSI with a virtual terminal** — JS equivalent of ratatui's `TestBackend` /
   codex's `vt100::Parser` is `@xterm/headless` (MIT, pure JS, Bun-compatible).
3. **Assert on the screen buffer** (visible-screen text), snapshot strings with
   `bun test` (`.snap`, `-u` to update).
4. **Visual review** renders the same captures to images: charmbracelet **vhs**
   (tape → GIF), asciinema + agg/svg-term, ttyd + browser screenshots, or a small
   xterm-buffer → HTML/SVG serializer (~200 lines) + headless Chrome
   `--screenshot` → PNG.
- PTY on this project: **`Bun.Terminal`** (Bun ≥ 1.3.5, POSIX-only) — already proven in
  our `test/helpers/tui-session.ts`. `node-pty` under Bun is broken
  ([oven-sh/bun#7362](https://github.com/oven-sh/bun/issues/7362)) — avoid.
- Gap in our current harness: the PTY master never answers terminal queries (OSC 11 bg,
  DA1 `\e[c`, kitty `\e[?u`, DSR `\e[?996n`), so theme detection always times out to its
  fallback path — deterministic theme testing needs a query responder.

## 4. Package shortlist (bun `--compile` safe)

| Need | Pick | License | Notes |
|---|---|---|---|
| TUI core | pi-tui (fork lineage) | MIT | N-API prebuilds embeddable; or pure-TS without Image |
| Markdown → ANSI | pi-tui `Markdown` (marked 18) | MIT | Already in tree; `highlightCode` hook |
| Syntax highlighting | cli-highlight (highlight.js) | ISC | Sync API fits the hook; already bundled today |
| Diffs | jsdiff + themed colorizer | BSD-3 | opencode's choice; add `auto|stacked` styles |
| Fuzzy match | pi-tui `fuzzy.ts` / fuzzysort | MIT | For `@` mentions and pickers |
| ANSI utils | pi-tui utils (visibleWidth, truncateToWidth, wrapTextWithAnsi) | MIT | Per-line SGR resets built in |
| Virtual screen | @xterm/headless | MIT | Assertion + HTML serialization for visual pipeline |
| PTY (e2e) | Bun.Terminal | Bun built-in | POSIX-only; Windows tracked in oven-sh/bun#25593 |
| Visual review | xterm-buffer → HTML → headless Chrome PNG; vhs (optional brew) | MIT | Judge-agent review of PNGs |

## 5. External research tools (used in the loop)

- `codex exec -m gpt-6-astra -s read-only --json -o <file> -C <repo> "<question>"` —
  architecture critique / code review (installed 0.155.0, astra is its default model).
- `grok --single -m grok-4.6 "<question>"` (`--output-format json` when structured) —
  second opinions (installed 1.0.34).
- Outputs land in `docs/tui/reviews/`.

## 6. Decision record

1. **Strategy: fork & own** (user-confirmed). Seed `packages/tui/` from upstream HEAD
   (`b8d8e95`, MIT) rather than de-minify the bundle; keep the exact
   `runTui`/`@zcode/tui` contract; keep the vendor bundle as reference/fallback until
   the parity matrix is green; keep attribution in `LICENSE-NOTE`.
2. **Engine: pi-tui stays.** OpenTUI rejected (FFI vs `--compile`), Ink rejected
   (weight), blessed rejected (unmaintained).
3. **Backlog priority after parity** (user-confirmed): performance first, visual polish
   second; opencode-style UX (palette/leader key) and configurability later.

## Sources

- https://github.com/sst/opencode + https://opencode.ai/docs/tui/ + packages/tui
  package.json/test tree (raw.githubusercontent.com)
- https://github.com/anomalyco/opentui + https://opentui.com
- https://github.com/earendil-works/pi + packages/tui README + `tui-plan.md` (raw)
- https://github.com/kingsword09/zcode-cli (MIT; HEAD `b8d8e95`)
- https://github.com/openai/codex codex-rs/tui `src/test_backend.rs`, tests, styles.md
- https://ratatui.rs (TestBackend + insta), https://github.com/vadimdemedes/ink (+ releases)
- https://github.com/charmbracelet/vhs , /crush (FSL), https://asciinema.github.io/avt ,
  https://github.com/asciinema/agg , https://github.com/tsl0922/ttyd
- https://bun.com/blog/bun-v1.3.5 (Bun.Terminal), https://bun.com/docs/bundler/executables,
  https://github.com/oven-sh/bun/issues/11598, /7362, /25593
- Local: `artifacts/tui-regions.json`, `/tmp/zcode-cli-upstream` clone, our
  `LICENSE-NOTE`, `test/helpers/*`
