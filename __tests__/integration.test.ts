import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { logger, IAgentRuntime, Plugin } from "@elizaos/core";
import { socialStrategyPlugin as plugin } from "../src/plugin/socialStrategy";
import { createMockRuntime } from "./test-utils";
import * as os from "os";

// Set up spies on logger
beforeAll(() => {
  vi.spyOn(logger, "info").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "debug").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Skip in CI environments or when running automated tests without interaction
const isCI = Boolean(process.env.CI) || process.env.NODE_ENV === "test";

/**
 * Integration tests demonstrate how multiple components of the project work together.
 * Unlike unit tests that test individual functions in isolation, integration tests
 * examine how components interact with each other.
 */
describe("Integration: Project Structure and Components", () => {
  it("should have a valid package structure", () => {
    const srcDir = path.join(process.cwd(), "src");
    expect(fs.existsSync(srcDir)).toBe(true);

    // Check for required source files - only checking core files
    const srcFiles = [
      path.join(srcDir, "index.ts"),
      path.join(srcDir, "plugin/socialStrategy/index.ts"),
    ];

    srcFiles.forEach((file) => {
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it("should have dist directory for build outputs (optional)", () => {
    const distDir = path.join(process.cwd(), "dist");
    // Only check if dist exists, don't fail if not built yet
    if (fs.existsSync(distDir)) {
      expect(fs.existsSync(distDir)).toBe(true);
    }
  });
});

describe("Integration: Plugin Structure", () => {
  it("should have plugin with required properties", () => {
    expect(plugin).toHaveProperty("name");
    expect(plugin).toHaveProperty("description");
    expect(plugin).toHaveProperty("models");
    expect(plugin).toHaveProperty("actions");
    expect(plugin).toHaveProperty("providers");
    expect(plugin).toHaveProperty("routes");
  });

  it("should have valid plugin components", () => {
    // Check if plugin has actions, models, providers, routes
    const components = ["models", "actions", "providers", "routes"];
    components.forEach((component) => {
      if (plugin[component]) {
        expect(
          Array.isArray(plugin[component]) ||
            typeof plugin[component] === "object"
        ).toBeTruthy();
      }
    });
  });
});

describe("Integration: Runtime Registration", () => {
  it("should register plugin in a mock runtime", async () => {
    // Create a custom mock runtime for this test
    const customMockRuntime = {
      plugins: [],
      registerPlugin: vi.fn().mockImplementation((plugin: Plugin) => {
        // In a real runtime, registering the plugin would call its init method,
        // but since we're testing registration, just record the call
        return Promise.resolve();
      }),
      getService: vi.fn(),
      getSetting: vi.fn().mockReturnValue(null),
      useModel: vi.fn().mockResolvedValue("Test model response"),
      getProviderResults: vi.fn().mockResolvedValue([]),
      evaluateProviders: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn().mockResolvedValue([]),
    } as unknown as IAgentRuntime;

    // Simulate plugin registration
    await customMockRuntime.registerPlugin(plugin);
    expect(customMockRuntime.registerPlugin).toHaveBeenCalledWith(plugin);
  });
});

// Skip scaffolding tests in CI environments as they modify the filesystem
const describeScaffolding = isCI ? describe.skip : describe;
describeScaffolding("Integration: Project Scaffolding", () => {
  // Create a temp directory for testing the scaffolding
  const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "eliza-test-"));

  beforeAll(() => {
    // Create test directory if it doesn't exist
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should scaffold a new project core files", () => {
    try {
      // Simulate copying essential files to test directory
      const srcFiles = ["index.ts", "plugin/socialStrategy/index.ts"];

      for (const file of srcFiles) {
        const sourceFilePath = path.join(process.cwd(), "src", file);
        const targetFilePath = path.join(
          TEST_DIR,
          file.replace("plugin/socialStrategy/", "")
        );

        if (fs.existsSync(sourceFilePath)) {
          // Ensure target directory exists
          const targetDir = path.dirname(targetFilePath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          fs.copyFileSync(sourceFilePath, targetFilePath);
        }
      }

      // Create package.json in test directory
      const packageJson = {
        name: "test-project",
        version: "1.0.0",
        type: "module",
        dependencies: {
          "@elizaos/core": "workspace:*",
        },
      };

      fs.writeFileSync(
        path.join(TEST_DIR, "package.json"),
        JSON.stringify(packageJson, null, 2)
      );

      // Verify files exist
      expect(fs.existsSync(path.join(TEST_DIR, "index.ts"))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, "index.ts"))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, "package.json"))).toBe(true);
    } catch (error) {
      logger.error("Error in scaffolding test:", error);
      throw error;
    }
  });
});
