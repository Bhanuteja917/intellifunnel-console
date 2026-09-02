import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    globalSetup: ["./vitest.globalSetup.ts"],
    pool: "forks",
    // Vitest 4 replaced `poolOptions.forks.singleFork` with this top-level
    // option (it forces maxWorkers to 1). Same effect the brief calls for:
    // parallel workers sharing one database would see each other's
    // truncations, so the whole run must execute in a single fork.
    fileParallelism: false,
  },
});
