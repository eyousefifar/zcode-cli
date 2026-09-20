# Vendor provenance

Every file in `vendor/` is extracted upstream code, not written here. This
document records where each file came from, what we changed on top, and how
to verify the bytes. See also `LICENSE-NOTE` (terms) and
`packages/tui/PROVENANCE.md` (the forked TUI sources).

## Contents

| File | Upstream | Introduced here |
|---|---|---|
| `zcode.cjs` | ZCode desktop app CLI engine, version **0.16.9** (app **3.14.0**, Z.ai proprietary), in the patched form produced by [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli)'s sync tooling at upstream commit `2e735f7` (17 interop patches; see `extraction` notes below) | `09b6d14` (0.16.5); updated to 0.16.9 in the app-3.14.0 sync |
| `cli-config.cjs` | Same engine, same sync path (CLI config module, incl. `assertSessionModelReady`) | `f9f4bca`; updated with the 0.16.9 sync |
| `zcode-builtin.json` | Builtin provider registry — byte-identical to the app's `Resources/config/provider/zcode-builtin.json` | `09b6d14`; updated with the 0.16.9 sync |
| `cli-settings-default.json` | Default CLI settings document, derived from the engine's embedded defaults literal | `09b6d14`; rewritten from the 0.16.9 defaults |
| `zcode-tui-index.js` | kingsword09/zcode-cli prebuilt TUI bundle (`packages/zcode-tui` dist at `2e735f7`) | `09b6d14`; updated with the 0.16.9 sync |
| `zcode-tui-LICENSE` | kingsword09/zcode-cli MIT license text | `09b6d14` |

### 0.16.9 sync notes (app 3.14.0, 2026-09-20)

- Extracted via upstream `scripts/sync-runtime.ts --app /Applications/ZCode.app`
  (run under bun with a temporary `node:sea` stand-in; the committed artifact
  is the pristine engine — the stand-in is not part of it).
- Upstream runtime patches applied by the sync (17): tui-execution-state,
  shared-config, session-model-recovery, official-mcp-availability, tui-bridge,
  model-catalog-reload, goal-failure-pause, terminal-tool-projection,
  detached-agent-lifecycle, agent-auto-background, http-no-content,
  network-retry-classification, stream-eof-finish-guard, sqlite-busy-timeout,
  oauth-http-errors, desktop-oauth, cli-help-contract (already present).
- Our local modifications below were re-applied on top (cli-config load-site
  rewiring ×4 sites; defensive optional chaining on the two turn metadata
  formatters).

The legacy TUI artifact (`zcode-tui-index.js`) is **not shipped by default
anymore**: `scripts/build.sh` overlays our own fork build
(`packages/tui/`, seeded from kingsword09 upstream commit `b8d8e95`) and keeps
the vendor bundle only as a build fallback/reference.

## Local modifications (all visible in git history)

1. `cli-config.cjs` require rewired to a bundler-resolvable relative path
   (the desktop-app resource path cannot resolve inside a single binary).
2. `zcode.cjs`: optional chaining on five property reads in the TUI
   turn-metadata formatter (defensive; fields absent under the standalone
   wrapper's session handling).

Nothing else is touched — byte-identical otherwise to the sync-tooling
output. The sync tooling itself applies documented interop bridges to the
extracted desktop bundle; those are upstream (kingsword09) changes, not ours.

**Known limitation:** the exact upstream sync revision / source artifact of
the kingsword09 sync that produced these files is not recorded here (the
vendor arrived in this repo before provenance tracking started). If you need
bitwise reproducibility against upstream, treat the SHA256SUMS in this
directory as the identity anchor and `git log --follow vendor/` as the change
history.

## Verification

```
shasum -a 256 -c SHA256SUMS     # from this directory (or sha256sum -c on Linux)
```

Any change to a vendored file must bump the hashes here and in the same
commit, and update the "Local modifications" list above.
