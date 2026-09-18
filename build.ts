// Build script: compiles src/entry.ts + vendor/zcode.cjs into a standalone binary.
//
//   bun run build.ts                      # native target -> dist/zcode
//   bun run build.ts all                  # all cross targets
//   bun run build.ts bun-linux-x64 ...    # specific targets
//
// A build-time plugin shims `node:sea` (the Node single-executable-application
// module, absent in bun) with an isSea()=false implementation — exactly what
// the bundle's own guarded lookups fall back to.

const TARGETS = {
  native: { outfile: "dist/zcode" },
  "bun-darwin-arm64": { outfile: "dist/zcode-darwin-arm64" },
  "bun-darwin-x64": { outfile: "dist/zcode-darwin-x64" },
  "bun-linux-x64": { outfile: "dist/zcode-linux-x64" },
  "bun-linux-arm64": { outfile: "dist/zcode-linux-arm64" },
} as const;

type TargetName = keyof typeof TARGETS;

const requested = process.argv.slice(2);
const names: TargetName[] =
  requested.length === 0
    ? ["native"]
    : requested.includes("all")
      ? Object.keys(TARGETS) as TargetName[]
      : (requested as TargetName[]);

for (const name of names) {
  const t = TARGETS[name];
  if (!t) {
    console.error(`unknown target: ${name} (known: ${Object.keys(TARGETS).join(", ")})`);
    process.exit(1);
  }
  const result = await Bun.build({
    entrypoints: ["src/entry.ts"],
    // "native" keeps the default (bun-darwin-arm64 on this machine);
    // cross targets get their explicit triple.
    ...(name === "native" ? {} : { target: name as never }),
    compile: { outfile: t.outfile },
    plugins: [seaShim()],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`built ${t.outfile}`);
}

function seaShim(): BunPlugin {
  return {
    name: "node-sea-shim",
    setup(build) {
      build.onResolve({ filter: /^node:sea$/ }, () => ({
        path: "node:sea",
        namespace: "node-sea-shim",
      }));
      build.onLoad({ filter: /.*/, namespace: "node-sea-shim" }, () => ({
        contents: `
export function isSea() { return false; }
export function getAsset() { throw new Error("node:sea assets are only available inside a Node SEA binary"); }
export function getAssetAsBlob() { throw new Error("node:sea assets are only available inside a Node SEA binary"); }
export default { isSea, getAsset, getAssetAsBlob };
`,
        loader: "js",
      }));
    },
  };
}
