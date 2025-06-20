import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["src/index.ts", "e2e/**/*.test.ts"],
  outDir: "dist",
  tsconfig: "./tsconfig.build.json",
  sourcemap: true,
  clean: true,
  format: ["esm"],
  dts: false,
  external: ["dotenv", "fs", "path", "https", "http", "zod"],
});
