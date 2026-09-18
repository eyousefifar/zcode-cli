# Provenance

Seeded from kingsword09/zcode-cli `packages/zcode-tui/src` at upstream commit
`b8d8e95a6449141d91fd9bca6e84ef322c6cdfde` ("fix(tui): restore draggable fullscreen
scrollbar (#159)", 2026-09-18), MIT licensed. `src/cli/` vendors that repo's CLI-helper
modules (`model-access`, `config-paths`, `app-server-client`, `plugin-protocol`,
`prompt-preflight`, `update-check`, `release-version`, `setting.example.json`) which
the TUI imports from its monorepo root; parent-relative imports were rewritten to
`./cli/`. Deviations from upstream carry `// [fork]` markers and a row in
`docs/tui/PARITY.md` (section 4).
