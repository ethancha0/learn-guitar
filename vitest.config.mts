import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the `@/*` path alias in tsconfig.json, which modules under test
  // import at runtime (not just as erased types).
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["features/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
