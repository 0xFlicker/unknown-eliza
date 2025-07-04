import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Get the actual project name from package.json
const packageJsonPath = path.join(process.cwd(), "package.json");
const packageJson = fs.existsSync(packageJsonPath)
  ? JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
  : {};

const PROJECT_NAME = packageJson.name || "social-strategy-agent";

describe("Environment Setup", () => {
  it("should verify configuration files exist", () => {
    const requiredFiles = [
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "tsup.config.ts",
      "vitest.config.ts",
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(process.cwd(), file);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it("should have proper src directory structure", () => {
    const srcDir = path.join(process.cwd(), "src");
    expect(fs.existsSync(srcDir)).toBe(true);

    // Ensure app entry point exists
    const entry = path.join(srcDir, "index.ts");
    expect(fs.existsSync(entry)).toBe(true);
  });

  it("should have a valid package.json with required fields", () => {
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    expect(packageJson).toHaveProperty("name");
    expect(packageJson).toHaveProperty("version");
    expect(packageJson).toHaveProperty("type", "module");
    expect(packageJson).toHaveProperty("main");
    expect(packageJson).toHaveProperty("module");
    expect(packageJson).toHaveProperty("types");
    expect(packageJson).toHaveProperty("dependencies");
    expect(packageJson).toHaveProperty("devDependencies");
    expect(packageJson).toHaveProperty("scripts");

    // Check for @elizaos/core dependency
    expect(packageJson.dependencies).toHaveProperty("@elizaos/core");

    // Check for build and test scripts
    expect(packageJson.scripts).toHaveProperty("build");
    expect(packageJson.scripts).toHaveProperty("test");
  });

  it("should have a valid tsup.config.ts for building", () => {
    const tsupConfigPath = path.join(process.cwd(), "tsup.config.ts");
    expect(fs.existsSync(tsupConfigPath)).toBe(true);

    const tsupConfig = fs.readFileSync(tsupConfigPath, "utf8");
    expect(tsupConfig).toContain("defineConfig");
    expect(tsupConfig).toContain("entry:");
    expect(tsupConfig).toContain("src/index.ts");
  });

  it("should have a valid README.md file", () => {
    const readmePath = path.join(process.cwd(), "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);

    const readme = fs.readFileSync(readmePath, "utf8");
    expect(readme.length).toBeGreaterThan(0);
  });
});
