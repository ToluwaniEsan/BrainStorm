import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // DB suites share one test database; run files serially to keep provisioning deterministic.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
