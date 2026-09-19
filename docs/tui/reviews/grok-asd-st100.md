I'll treat this as a critique of the audit itself: verify the findings against the tree, hunt for system-level holes the three reviews missed, and then re-rank severity plus a next-release fix list. Starting with architecture and the cited hotspots.Architecture is mapped. Next I’ll verify the cited findings and hunt the system-level gaps the audits named: supply chain, drift, secrets, migration, and long-session behavior.The existing ASD-ST100 doc already absorbed most of A–S. I’m going after what it still doesn’t cover: vendor provenance, CI-on-PR, plugins/MCP inherited from desktop, native addons, and session-data isolation.The three audits looked at the shim, the TUI fork, and the release scripts. They barely treated `vendor/zcode.cjs` as a running product. That is the hole. The 11 MB engine is what a stranger actually executes: plugins, MCP, session DB, OAuth, telemetry, remote-control sockets, marketplace fetches. Most of A–S is real; the ranking and the coverage are not.

One meta problem first. Your rubric says **P0 = blocks release**. Codex then wrote “no P0 found; I would block the next release.” Those cannot both be true. Several P1s are release-blockers that got a softer label so the scorecard could say “no P0.”

---

## 1. What all three of you missed

### Supply chain (the shipped artifact is untrustable)

- **There is no PR/push CI.** `.github/workflows/` contains only `release.yml`, and it fires on tags. The 44/44 suite, the gate, and the visual captures are a developer-machine ritual. A compromised PR never has to go green.
- **The 11.4 MB proprietary blob has no provenance recipe.** No extract script, no `SHA256SUMS` next to `vendor/zcode.cjs`, no “this bytestring came from ZCode.app 0.16.5 / kingsword09 sync at commit X.” LICENSE-NOTE admits local patches. Git stores the blob; nothing proves the next bump is the same object you audited.
- **Release actions are floating tags** (`actions/checkout@v4`, `oven-sh/setup-bun@v2` with `bun-version: latest`, `softprops/action-gh-release@v2`). That is a textbook Actions supply-chain miss. Finding B noted unpinned bun and missing checksums; it did not note unpinned actions.
- **README’s install path is `curl | chmod +x` with no checksum.** Even after you add `sha256sums` to the GitHub release, the documented install still does not verify them.
- **Darwin binaries are unsigned.** Gatekeeper quarantine will make the advertised `curl` install fail for strangers in ways `--version` on a Linux runner cannot see. Notarization was never mentioned.
- **Search binaries are trusted from `/Applications/ZCode.app` with no hash** (`src/entry.ts` lines 105–115). A stale or malicious app install silently becomes `rg`/`bfs`/`ugrep` for this CLI.
- **pi-tui ships prebuilt `.node` files for darwin/win32 only.** `build.ts` does not copy them next to the compiled binary. Linux TUI width/image support degrades with no message. Architecture review flagged this; the synthesized list dropped it to A8 “unverified.”
- **Official plugins are on by default and fetched from the network.** The engine defaults `browser-use`, `document-skills`, `skill-creator`, `zcode-guide` from `https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`. `plugins.enabled: true` in `vendor/cli-settings-default.json`. That is remote code execution adjacent to the agent, with no pin, no signature check in *this* repo, and no test.
- **Eval replay collapses a process boundary.** The vendor does `spawn(process.execPath, ["--input-type=module", "--eval", …])` in **two** places. In the compiled binary, `execPath` is the full CLI, so helper JS runs **in-process** via `data:` import, sharing env, credentials, and heap with the agent. Finding A treated this as a crash. The crash is the symptom; the missed issue is that a child that used to be disposable now sits inside the secret-bearing process. There is also no argv normalization (Codex’s P2), so payload vs flags are wrong.

### Secrets / egress (privacy was waved off)

- **Aliyun ARMS RUM URL is hardcoded** (`https://proj-xtrace-…aliyuncs.com/rum/web/v2?…`). Codex listed it as a non-finding because OTLP needs an endpoint. RUM is a different channel (`mapZCodeEnvToArmsRumEnv`). Nobody showed it does *not* fire on CLI startup.
- **There is no `ZCODE_DISABLE_TELEMETRY` / `DO_NOT_TRACK` in the bundle.** ENV.md’s `ZCODE_TELEMETRY_*` is a shrug. Opt-out may not exist.
- **Web remote control is in the shipped engine:** `wss://zcode.z.ai/ws`, `DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL`, plus a second OAuth client `client_RzngVdSk8sYsG2_3HzOMdQ`. Desktop-only in intent, present in the CLI binary, and reachable if shared desktop settings turn it on.
- **Intranet probe:** default host `studio.zcode-ai.com:12345` (`/zcode/deps`). Stranger machines may probe an unexpected host.
- **`installCredentials()` copies the developer’s encrypted login into `/tmp/zcode-sandbox-*`.** Crash-before-dispose leaves secrets on disk. Tests also reconstruct `ZCODE_CREDENTIAL_SECRET` from the real `HOME`/`USER`.
- **`/login` resume uses `stdio: inherit` and `process.env` wholesale;** `ZCODE_TUI_LOGIN_CMD` is executed via `$SHELL -lc`. Architecture review called the alt-screen leak; the synthesized list dropped both the leak and the env-inheritance.

### User data / isolation (the README claim is false, and sessions are the missing piece)

Finding N is about `setting.json` races. The larger lie is **sessions**.

| State | Actual path | Isolated by `ZCODE_DATA_BASE_DIR`? |
|---|---|---|
| Credentials / providers | `~/.zcode-standalone/.zcode/v2/` | Yes (shim) |
| Session DB | `~/.zcode/cli/db/db.sqlite` (hardcoded `Wft()` in vendor + defaults) | **No** |
| TUI settings, update cache, migrations | `~/.zcode/cli/` | **No** |
| Logs | `$HOME/.zcode/cli` | **No** |

Consequences nobody wrote down:

- Wiping `~/.zcode-standalone` does not wipe chats.
- Uninstalling/upgrading the desktop app can destroy CLI sessions.
- `zcode logout` does not define what happens to sqlite.
- There is **no export/import, no “migrate from desktop,” no schema version check on `--resume`**.
- Default `cli-settings-default.json` is copied only if the file is missing. Existing users never receive new keys.
- Because settings are shared, **desktop MCP servers, hooks, and plugin dirs become CLI behavior.** Isolation is not a prefs bug; it is an unexpected code-execution surface.

### Semantic versioning of the core↔TUI contract

- `package.json` version **is** the core version (`0.16.5`). TUI is `0.1.0-fork.1` and is not part of the public version. You cannot ship a TUI-only fix without implying a core bump, and you cannot express “TUI 2, core 0.16.5.”
- Vendor `loadTuiRuntime` literally joins `"0.16.5"` into a SEA extract path. Compatibility is a string in a minified blob, not a protocol.
- `RuntimeAdapter` has no `protocolVersion`. Every method except `submitPrompt` is optional, so core 0.17 dropping a callback becomes a silent empty UI (today: `@plugin` autocomplete). Finding O described the symptom and not the missing contract test: freeze adapter method names + event vocabulary against `vendor/zcode.cjs` in CI, fail when either side drifts.
- `PARITY.md` still says the vendor overlay ships until the gate is green. `scripts/build.sh` already prefers `packages/tui/dist`. You are shipping the fork while the ledger says you are not. That is an O2 (truthful verification) failure bigger than “rows lack tests.”
- Upstream-drift “known-left” watches **kingsword09**. Nobody watches **Z.ai desktop / core 0.16.6**. The engine you wrap can move without the TUI seed moving.

### Long-session behavior (finding R is partly wrong, and missed the real leaks)

Verified in tree:

- Editor history **is** capped at 100 (`index.ts` ~1177).
- Transcript **is** capped (480 blocks / 2M chars).
- `completedTurnIds` **is** capped at 32.
- Turn diffs capped at 20; background-task logs capped per task.

So “unbounded editor history” is false. Real long-session issues the audits skipped:

- **`InputQueue.queuedFollowUps` is unbounded** (that part of R is right).
- **`restoredNoticeSeen` and `backgroundCoordinatorMessageIds` are unbounded Sets.**
- **Plugin catalog caches forever** (no invalidation).
- **Runtime poll is `isDeepStrictEqual` of the full projection every 1s while tools run, 5s idle** — CPU leak over an 8-hour session, not a memory one.
- **On-disk sqlite is unbounded**; resume can spike RAM via `loadSessionTranscript` before the TUI cap applies.
- **No `uncaughtException` / `unhandledRejection` handler that calls `ui.stop()`.** A throw in a tool renderer leaves the user’s terminal in alt-screen/raw/mouse mode. Architecture review had this; synthesized A–S dropped it.
- **Mermaid/ELK is in the TUI bundle** with no size gate (architecture review; dropped).

---

## 2. Severity challenges

| ID | You said | I say | Why |
|---|---|---|---|
| **B** release.yml | P1 | **P0** | P0 means blocks release. Four untested, unsigned, checksum-free binaries on a `latest` bun, plus `curl \| chmod`, is not a releasable artifact. |
| **A** eval crash | P1 | **P1**, but under-scoped | Keep P1 as a user-visible defect. Promote the in-process sandbox collapse to its own P1. If any common `-p`/plugin path hits the helper, it becomes P0. |
| **N** shared settings | P2 | **P1** | README promises isolation. Shared `setting.json` plus MCP/hooks/plugins is a false product claim and a clobber/RCE path, not a polish item. |
| **I** session DB / read-only HOME | P2 | **P1** (session DB half) | `--version` passing while `-p` dies is the writability bug (P2). Sessions living outside the data dir is a data-loss/privacy P1. |
| **F** node crash | P1 | **P2** | `engines.bun` is documented. Opaque crash is rude, not a ship-stopper, unless you advertise npm-on-node this release. |
| **D** real credentials in T3 | P1 | **P1 process / P3 product** | Does not affect the binary. It does block O1 (“works from nothing”) and any honest CI claim. Keep it in the next-release list *because* you cannot prove the release without it. |
| **C** gate perf → live API | P1 | **P1 process, not product** | Correct as a verification lie. Default `RUN_PERF=0` is a one-line fix; do not let it crowd out isolation or eval. |
| **G** parity fiction | P1 | **P1 docs, plus a hidden P1** | Untested rows are P1-for-O2. The overlay already shipping the fork while PARITY says vendor is the overlay is the actual integrity bug. |
| **J** update-check | P2 | **P3** | Dormant via `??= "1"`. Empty-string re-enable is a footgun, not a default network call. |
| **K** debug event log | P2 | **P3** | Opt-in env. Mode `0600` is still worth doing; it does not belong on a release-critical list. |
| **H** fork deps location | P2 | **P3** | Hoisting works. Fix when you touch the package manifest. |
| **R** unbounded memory | P3 | **P3, and partly false** | Editor history and transcript are already capped. Keep input-queue cap + Sets. |
| **O** contract drift | P2 | **P2**, but the missing *protocol* is P2-process going to P1 on the next core bump | `@plugin` empty is UX. No CI freeze of the adapter/event vocabulary is how 0.16.6 will surprise you. |
| **E** npm publish | P1 | **P1 iff npm is a ship channel this release** | If the release is GitHub binaries only, this is P2 until you actually `npm publish`. |

**Not in A–S and should have been:**

| Missed | Sev | |
|---|---|---|
| No PR CI; tag-only workflow | **P0** | Same class as B. |
| Unsigned darwin + curl without verify | **P0** | Stranger install is the product. |
| Vendor blob provenance / extract recipe | **P1** | You cannot rebuild or audit what you ship. |
| Default official plugins + CDN marketplace | **P1** | Network + code load, untested. |
| Session DB not under data dir | **P1** | See I/N. |
| Eval in-process isolation collapse | **P1** | Beside the crash. |
| No crash-restore of the terminal | **P1** | One throw bricks the user’s shell. |
| Native addons not packaged; Linux silent degrade | **P1** for Linux TUI | A8 was too meek. |
| ARMS RUM / remote-control / intranet probe undisclosed | **P1** disclosure, P2 until proven dormant | Do not dismiss because OTLP is gated. |
| No core↔TUI protocol version + no core-drift watcher | **P2** | Will become P1 at 0.16.6. |

---

## 3. Top-10 ordered fix list for the next release

Order is “what makes a stranger’s install honest,” not “what is easiest.”

1. **Make the tag pipeline a real release, or do not tag.** Pin bun and Actions SHAs; run the offline gate; smoke `--version` *and* a sandboxed `-p`/`tui` on every uploaded target (including a darwin runner); write `SHA256SUMS`; change README install to verify the hash. *Rationale:* without this you are publishing unexecuted bits to `curl`.*
2. **Stop claiming isolation; then make it true.** Point session DB, logs, and `setting.json` at `ZCODE_DATA_BASE_DIR`; create settings with `wx`; do not inherit desktop MCP/hooks/plugin dirs. *Rationale:* this is the user-data and surprise-RCE bug; N/I understated it.*
3. **Fix eval replay as a lifecycle *and* a sandbox.** Keep a private `process` ref, drain the event loop, strip argv to payload, add an e2e that actually triggers both `--eval` helpers. *Rationale:* A is the only P1 that already crashes a successful run in the compiled binary.*
4. **Make tests run on a clean machine.** Synthetic coding-plan credentials in the real layout; `RUN_PERF=0`; absolute binary paths; TUI case with timeout and `</dev/null`; fail if perf produced no numbers. *Rationale:* D+C+L are how you prove (1) and (3); today the gate is a live-API, credential-copying local script.*
5. **Restore the terminal on the way down.** `uncaughtException`/`unhandledRejection` → `ui.stop()`; assert alt-screen/raw/mouse after `/login` suspend. *Rationale:* one renderer throw is a worse user event than a missing `/search` test.*
6. **Package or explicitly disable native addons and app-bundled tools.** Copy pi-tui `.node` next to the binary where they exist; on Linux print that modifiers/images are software-only; do not silently pick `/Applications/ZCode.app` binaries without a hash, or document that PATH wins. *Rationale:* Linux TUI and search-tool integrity are ship behavior, not backlog.*
7. **If npm ships this cut: `prepack`, keep explicit `npm` when `all` is passed, bun-runtime guard, publish from CI.** If it does not ship, drop it from the P1 list in public notes. *Rationale:* E/F are channel bugs; do not let them outrank isolation.*
8. **Tell the truth in PARITY.md and the overlay.** Either overlay vendor until gated rows have tests, or admit the fork is what ships and mark ungated rows `none`. Add one contract test: `runTui` export + adapter method names + event vocabulary vs `vendor/zcode.cjs`. *Rationale:* G is a doc lie; the overlay flip is a product lie; O is the 0.16.6 footgun.*
9. **Disclose and gate engine egress.** Document ARMS RUM, `wss://zcode.z.ai/ws`, intranet `studio.zcode-ai.com:12345`, official plugin CDN; default plugins off in *this* distribution or pin marketplace hashes; find or add a real telemetry off switch. *Rationale:* an unofficial binary that phones home is a trust-killer even if “upstream did it.”*
10. **Write the missing migration/version story in one page, then enforce it.** Independent TUI vs core versions; `doctor` checks data-dir writability and isolation; a `zcode migrate` (or a documented “sessions live in ~/.zcode/cli, here is how to copy”); a weekly job for **both** kingsword09 *and* Z.ai core bumps. *Rationale:* without this, every later P2 (settings schema, resume, `@plugin`) keeps coming back as a surprise.*

Leave for later: H, J, K, P, Q, mermaid size, dual-run golden, musl, Windows. Q (docs) is cheap and should ride along with 2 and 8, but it should not be a numbered engineering item.

**Do not ship** until 1–3 are done. 4 is how you know 1–3 worked. Everything else can be the release after, with 9 as a docs+defaults patch if you cannot reverse-engineer RUM in time — but then say so in README, not in ENV.md as “see strings in the bundle.”
