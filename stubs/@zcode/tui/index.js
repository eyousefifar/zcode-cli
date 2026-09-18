// Stub for the optional @zcode/tui package.
//
// The desktop app ships the CLI engine (zcode.cjs) without this package, so
// the interactive TUI is unavailable in the stock CLI as well — this stub
// just replaces Node's "Cannot find package" with a clear message.
throw new Error(
  "Interactive TUI is not available: the @zcode/tui package is not shipped " +
    "with the ZCode desktop app's CLI bundle. Use headless mode instead: " +
    'zcode -p "your prompt"',
);
