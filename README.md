# zcode-cli (standalone)

Unofficial standalone distribution of the **ZCode CLI** — the agent engine
that ships inside the [ZCode desktop app](https://zcode.z.ai) — packaged as a
single self-contained binary with [bun](https://bun.sh) `build --compile`, or
as a thin package that runs on bun.

> ⚠️ **Unofficial.** This repository redistributes Z.ai's compiled CLI bundle
> (`vendor/zcode.cjs`, ~11 MB, minified) unmodified apart from a documented
> build-time shim. It is not affiliated with or endorsed by Z.ai. See
> [LICENSE-NOTE](LICENSE-NOTE).

## Why

The desktop app bundles a full headless agent CLI (`zcode -p "..."`) but
doesn't install it on your PATH, and running it by hand requires
`ELECTRON_RUN_AS_NODE=1` plus several environment workarounds. This project
wraps that bundle so `zcode` is a normal command:

- single ~77 MB binary, no runtime dependencies
- provider config embedded (no app install needed)
- state isolated from the desktop app in `~/.zcode-standalone`
- login via `zcode login` (Z.AI OAuth)

## Install

### Binary (macOS/Linux)

Grab the artifacts for your platform **and the `SHA256SUMS` file** from
[Releases](https://github.com/eyousefifar/zcode-cli/releases). Verify before
you execute — an unverified binary is a stranger's binary:

```bash
V=$(curl -fsSL https://api.github.com/repos/eyousefifar/zcode-cli/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
for f in zcode-darwin-arm64 zcode-darwin-x64 zcode-linux-x64 zcode-linux-arm64 SHA256SUMS; do
  curl -fLO "https://github.com/eyousefifar/zcode-cli/releases/download/v${V}/${f}"
done
# macOS: `shasum -a 256 -c`; Linux: `sha256sum -c`
shasum -a 256 -c SHA256SUMS || exit 1
sudo cp zcode-darwin-arm64 /usr/local/bin/zcode   # pick your platform's file
sudo chmod +x /usr/local/bin/zcode
```

The release pipeline itself executes every target binary (native macOS, Intel
macOS, Linux x64, Linux arm64 under qemu) and asserts its version matches the
tag before anything is published — see `.github/workflows/release.yml`.

### npm (thin package — runs on bun)

```bash
bun install -g @eyousefifar/zcode-cli
# or one-shot:
bunx @eyousefifar/zcode-cli -p "hello"
```

### From source

```bash
git clone https://github.com/eyousefifar/zcode-cli
cd zcode-cli
bash scripts/build.sh          # -> dist/zcode
bash scripts/test.sh dist/zcode
```

## First run

```bash
zcode login          # opens Z.AI OAuth (or --no-browser to print the URL)
zcode doctor
zcode -p "Reply with exactly: ok"
```

State lives in `~/.zcode-standalone/.zcode/v2/` — the desktop app's login is
not shared or touched.

> **Stability tip:** OAuth tokens rotate whenever the desktop app is running,
> which invalidates the CLI's copy. For unattended/headless use, configure the
> coding-plan **API key** instead — see
> [docs/TESTING.md](docs/TESTING.md) "Model selection notes".

## Usage

```bash
zcode -p "explain this repo"                      # one-shot answer
zcode -p "explain this repo" --json               # structured output + usage
zcode -p "review diff.diff" --attach diff.diff    # attach files
zcode -p "summarize" --mode build                  # permission modes: build/edit/yolo
zcode -c -p "go on"                               # continue latest session
zcode --resume sess_... -p "what did I ask?"      # resume by id
zcode --target "fix the failing tests"            # autonomous goal run
```

Full option reference: [docs/OPTIONS.md](docs/OPTIONS.md) ·
Environment variables: [docs/ENV.md](docs/ENV.md) ·
Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) ·
Test matrix: [docs/TESTING.md](docs/TESTING.md)

## How the packaging works

`src/entry.ts` (binary) and `src/npm-entry.ts` (npm) are small shims that repair the
bundle's environment assumptions, then load `vendor/zcode.cjs`:

1. embed the builtin provider registry (`vendor/zcode-builtin.json`) and point
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` at it
2. default `ZCODE_DATA_BASE_DIR` to `~/.zcode-standalone` (isolation from the
   desktop app)
3. reuse the app's bundled ripgrep/bfs/ugrep when `/Applications/ZCode.app`
   exists
4. normalize `process.argv` for bun's virtual filesystem and self-respawn
   patterns (compiled binary only)
5. shim `node:sea` at build time (absent in bun) with `isSea() = false`

The bundle itself is unmodified.

## Known limitations

- Some flags in upstream `--help` are not actually parsed (`--allowed-tools`,
  `--max-turns`, ...). See [docs/OPTIONS.md](docs/OPTIONS.md).
- Browser Use backend needs `playwright-core`, which is stubbed out.

## Non-goals

- **Windows binaries** — the engine's Windows story is the desktop app; the
  npm entry runs under bun on Windows but has no compiled binary target.
- **linux-musl** — bun cross-targets are glibc; Alpine needs the npm entry.
- **Bundling Chrome for Browser Use** — headless Browser Use requires a
  system Chrome/Chromium (`--browser-executable`).

## Credits

- [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli) — the
  interactive TUI (`packages/tui/`, forked at their commit `b8d8e95`) is their
  MIT-licensed work, as is the sync tooling that extracts the engine bundle
  (`vendor/`, Z.ai proprietary — see [LICENSE-NOTE](LICENSE-NOTE) and
  [vendor/PROVENANCE.md](vendor/PROVENANCE.md)); their project is also a
  full-featured npm-distributed alternative with their own launcher.
- [earendil-works/pi](https://github.com/earendil-works/pi) — pi-tui, the
  terminal rendering engine under the TUI.

## Engineering docs

- [docs/ASD-ST100.md](docs/ASD-ST100.md) — full system assessment and
  remediation roadmap (release integrity, isolation, egress, agent-loop tests).
- [docs/tui/](docs/tui/) — TUI research, architecture, parity matrix, testing
  and the three-tier test suite description.
- [docs/EGRESS.md](docs/EGRESS.md) — every network endpoint this
  distribution can contact, with the enforcement story.

## Versioning

Versions track the upstream CLI version found in the app bundle
(`0.16.9` from app 3.14.0 at time of packaging).
