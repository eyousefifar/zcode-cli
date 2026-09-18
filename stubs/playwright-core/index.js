// Stub for the optional playwright-core dependency (Browser Use backend).
//
// The desktop app resolves this from its own node_modules; standalone builds
// replace Node's "Cannot find package" with a clear message.
throw new Error(
  "Browser Use is not available: playwright-core is not bundled in this " +
    "standalone build. Install it (npm i playwright-core) and set NODE_PATH, " +
    "or run the CLI from the ZCode desktop app.",
);
