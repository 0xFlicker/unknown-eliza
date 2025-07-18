import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    silent: false,
    testTimeout: 60000,
    exclude: ["**/e2e/**", "**/node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // "@elizaos/plugin-social-strategy": path.resolve(
      //   __dirname,
      //   "..",
      //   "..",
      //   "packages/plugin-social-strategy/src"
      // ),
    },
  },
});
