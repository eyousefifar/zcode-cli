I'll treat this as a code-backed re-audit of HEAD `0fe66ff`: first close or keep open the round-2 flip-condition, then spot-check the Codex punch list and remaining ship proofs.This is a punch-list re-audit, not a branch-diff review. I'll pin HEAD, then verify the flip-condition and Codex items directly in the named files.HEAD matches `0fe66ff`. Next I’ll read the named files and the prior judge notes so each punch-list claim can be checked against current code.Flip-condition files look closed on first pass. Next I’ll verify remaining spawn paths, eval-replay, TUI stop/tests, and the release workflow.Core files check out; I’ll now inspect `stop()`, remaining env/spawn paths, and the eval-replay/writeSync edge cases for anything that still flips the verdict.Vendor grep for `ZCODE_HTTP_PROXY` came up empty — I’ll confirm the real proxy env names and whether `Bun.spawn` actually honors `detached`.Confirmed Bun’s `process.kill(-pid)` and that `writeSync`’s third argument is a file position. I’ll pull the last line-accurate cites, then give the ship verdict.HEAD moved during the audit. I’ll pin it back to `0fe66ff` and check whether `0ca9134` changed any of the punch-list files.Verified at `0fe66ffa5bf40b8b06582569833f14921393997a` (working tree later advanced to docs-only `0ca9134`; punch-list source is identical).

# FLIP-CONDITION: CLOSED

Round 2’s load-bearing claim is now true in code: the gate dead-sink reaches sandboxed children, and the vendor’s native proxy vars are set.

1. `test/helpers/sandbox.ts:94-104` copies `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`, the lowercase forms, and `ZCODE_HTTP_PROXY` / `ZCODE_HTTPS_PROXY` / `ZCODE_NO_PROXY` from the test process into every sandbox env.
2. Both product launchers consume that object: `runBinary` (`sandbox.ts:210`) and `startTui` (`tui-session.ts:104`).
3. `scripts/gate.sh:23-36` sets the dead sink on standard **and** `ZCODE_*` vars before any test tier.
4. Vendor mapping is real: `vendor/zcode.cjs` defines `ZCODE_HTTP_PROXY` / `ZCODE_NO_PROXY` (and still consults `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`). `ZCODE_HTTPS_PROXY` is absent in the blob — extra, not a hole.
5. `docs/EGRESS.md:3-18` now states the enforced / recorded / not-visible model instead of claiming a total cage.

Live probe: Bun `process.kill(-pid)` addresses a process group and SIGKILL yields 137.

# Punch list

| Item | Verdict | Evidence |
|---|---|---|
| sandbox.env() proxy propagation | **CLOSED** | `sandbox.ts:98-104` |
| gate.sh standard + `ZCODE_*` dead sink | **CLOSED** | `gate.sh:24-35` |
| eval-replay process group + persistent `.on` + SIGKILL | **CLOSED** | `entry.ts:92-129`: `detached: true`, `kill(-child.pid)`, `.on` not `.once`, 2s SIGKILL. Escalation test: `eval-replay.test.ts:51-77` |
| `applyStateIsolation()` before `preflightStateDir()` | **CLOSED** | `entry.ts:171-173`, `npm-entry.ts:32-34` |
| preflight validates db/log destinations | **CLOSED** | `state-isolation.ts:55-71` after defaults at `22-33` |
| settings write-all + tmp ownership | **CLOSED** for the punch-list claim | `state-isolation.ts:86-110`: `created` only after `openSync("wx")`; exclusive `linkSync` |
| fork `stop()` isolates each cleanup | **CLOSED** | `packages/tui/src/index.ts:5704-5747`: per-step try, `ui.stop()` in its own try |
| TUI Allow/Esc assert tool-role messages | **CLOSED** | Allow: `tui.e2e.test.ts:187-190` `role === "tool"` + workspace file. Esc: `243-247` tool-role + `/cancel\|deny\|denied/`. Mock follow-up requires `tool_call_id` (`model-server.ts:229-241`) |
| release upload = push+tag; `contents:write` on publish only | **CLOSED** | workflow `contents: read` (`release.yml:23-24`); publish job `contents: write` (`139-140`); upload `if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')` (`163`) |
| EGRESS enforced/observed/not-visible | **CLOSED** | `docs/EGRESS.md:3-18` |

# NEW findings

None at bug/P1. Two residuals, neither a flip:

1. **suggestion** — `src/state-isolation.ts:90-93`. The write-all loop calls `writeSync(fd, string, offset)` using the **string** overload, where the third argument is a file position, not a remaining-bytes offset. Confirmed with a Bun probe: `writeSync(fd, "abcdefghij", 3)` produced `abcabcdefghij`. A short write would republish the whole string at a shifted position. Default settings are 1607 ASCII bytes, so a short write is unrealistic without fault injection. Tmp ownership is still correct. Codex’s sibling-file + exclusive-link pattern is in place.

2. **suggestion** — `test/unit/eval-replay.test.ts:76`. Escalation accepts `code === 137 \|\| code === 0`. That does not pin SIGKILL, and it does not assert a grandchild is gone. Wrapper still waits on `child.exited` after group kill (`entry.ts:130-131`). Production supervision matches the punch list.

# SHIP for tagging v0.16.6

The round-2 flip condition is closed in code. Codex round-2 items listed above are closed. I would tag after the two operational proofs, not after more code.

**Remaining proofs to watch (yes, those two — plus one tag-prep check):**

1. **CI gate, network-denied, macOS** — `ci.yml:26-42` runs `bash scripts/gate.sh` on `macos-14`. With `gate.sh` exporting the dead sink *and* `sandbox.env()` propagating it, this is now the real deny for proxy-honoring SUT traffic, not just the bun-test process.
2. **Four-target release dry run** — `workflow_dispatch` still verifies all four digests; `softprops/action-gh-release` cannot publish on dispatch-on-tag. Matrix: `darwin-arm64` / `macos-14`, `darwin-x64` / `macos-15-intel`, `linux-x64` native, `linux-arm64` qemu.
3. **Tag-prep, not a punch-list defect:** `package.json` is still `0.16.5` (`package.json:3`); `doctor` e2e asserts `0.16.5` (`headless.e2e.test.ts:332`). A `v0.16.6` tag push will fail `release.yml:112-115` (`got != tag`) until the reported version is bumped. Codex r3 already classified this as tag preparation. Dispatch from `main` skips the version check (`want=""`).

I did not rerun the gate or watch a live Actions run. Commit message at `0fe66ff` claims 74 tests green under network denial; that is unverified here.
