# Vendor provenance

Every file in `vendor/` is extracted upstream code, not written here. This
document records where each file came from, what we changed on top, and how
to verify the bytes. See also `LICENSE-NOTE` (terms) and
`packages/tui/PROVENANCE.md` (the forked TUI sources).

## Contents

| File | Upstream | Introduced here |
|---|---|---|
| `zcode.cjs` | ZCode desktop app CLI engine, version **0.16.5** (Z.ai proprietary), in the patched form produced by [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli)'s sync tooling | `09b6d14` |
| `cli-config.cjs` | Same engine, same sync path (CLI config module) | `09b6d14` |
| `zcode-builtin.json` | Same engine (builtin provider registry data) | `09b6d14` |
| `cli-settings-default.json` | Same engine (default CLI settings document) | `09b6d14` |
| `zcode-tui-index.js` | kingsword09/zcode-cli prebuilt TUI bundle (`packages/zcode-tui` dist) | `09b6d14` |
| `zcode-tui-LICENSE` | kingsword09/zcode-cli MIT license text | `09b6d14` |

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

## Verification

```
shasum -a 256 -c SHA256SUMS     # from this directory (or sha256sum -c on Linux)
```

Any change to a vendored file must bump the hashes here and in the same
commit, and update the "Local modifications" list above.
