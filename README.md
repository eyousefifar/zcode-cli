# zcode-cli (standalone)

Unofficial standalone distribution of the **ZCode CLI** — the agent engine
that ships inside the [ZCode desktop app](https://zcode.z.ai) — packaged as a
single self-contained binary with [bun](https://bun.sh) `build --compile`, or
as a thin npm package for existing node/bun installs.

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

Grab the artifact for your platform from
[Releases](https://github.com/eyousefifar/zcode-cli/releases):

```bash
curl -fL https://github.com/eyousefifar/zcode-cli/releases/latest/download/zcode-darwin-arm64 -o /usr/local/bin/zcode
chmod +x /usr/local/bin/zcode
```

### npm (thin package — runs on your node ≥ 22.5 or bun)

```bash
npm install -g @eyousefifar/zcode-cli
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
zcode login          # opens Z.ai OAuth (or --no-browser to print the URL)
zcode doctor
zcode -p "Reply with exactly: ok"
```

State lives in `~/.zcode-standalone/.zcode/v2/` — the desktop app's login is
not shared or touched.

## Usage

```bash
zcode -p "explain this repo"                      # one-shot answer
zcode -p "explain this repo" --json               # structured output + usage
zcode -p "review diff.diff" --attach diff.diff    # attach files
zcode -p "summarize" --mode plan                  # permission modes: build/edit/plan/yolo
zcode -c -p "go on"                               # continue latest session
zcode --resume sess_... -p "what did I ask?"      # resume by id
zcode --target "fix the failing tests"            # autonomous goal run
```

Full option reference: [docs/OPTIONS.md](docs/OPTIONS.md) ·
Environment variables: [docs/ENV.md](docs/ENV.md) ·
Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) ·
Test matrix: [docs/TESTING.md](docs/TESTING.md)

## How the packaging works

`src/entry.ts` (binary) and `src/bin.js` (npm) are small shims that repair the
bundle's environment assumptions, then load `vendor/zcode.cjs`:

1. embed the builtin provider registry (`vendor/zcode-builtin.json`) and point
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` at it
2. default `ZCODE_DATA_BASE_DIR` to `~/.zcode-standalone` (isolation from the
   desktop app)
3. reuse the app's bundled ripgrep/bfs/ugrep when `/Applications/ZCode.app`
   exists
4. normalize `process.argv` for bun's virtual filesystem and self-respawn
   patterns
5. shim `node:sea` at build time (absent in bun) with `isSea() = false`

The bundle itself is unmodified.

## Known limitations

- No interactive TUI (`@zcode/tui` is not shipped by the desktop app either).
- Some flags in upstream `--help` are not actually parsed (`--allowed-tools`,
  `--max-turns`, ...). See [docs/OPTIONS.md](docs/OPTIONS.md).
- Browser Use backend needs `playwright-core`, which is stubbed out.

## Versioning

Versions track the upstream CLI version found in the app bundle
(`0.16.5` at time of packaging).
