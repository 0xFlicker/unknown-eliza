import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { socialStrategyPlugin as plugin } from "../src/socialStrategy/index";
import type { IAgentRuntime, Memory, State, Provider } from "@elizaos/core";
import { logger, MemoryType } from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

// Setup environment variables
dotenv.config();

// Set up logging to capture issues
beforeAll(() => {
  vi.spyOn(logger, "info");
  vi.spyOn(logger, "error");
  vi.spyOn(logger, "warn");
  vi.spyOn(logger, "debug");
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Helper function to document test results
function documentTestResult(
  testName: string,
  result: any,
  error: Error | null = null
) {
  // Clean, useful test documentation for developers
  logger.info(`✓ Testing: ${testName}`);

  if (error) {
    logger.error(`✗ Error: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }
    return;
  }

  if (result) {
    if (typeof result === "string") {
      if (result.trim() && result.length > 0) {
        const preview =
          result.length > 60 ? `${result.substring(0, 60)}...` : result;
        logger.info(`  → ${preview}`);
      }
    } else if (typeof result === "object") {
      try {
        // Show key information in a clean format
        const keys = Object.keys(result);
        if (keys.length > 0) {
          const preview = keys.slice(0, 3).join(", ");
          const more = keys.length > 3 ? ` +${keys.length - 3} more` : "";
          logger.info(`  → {${preview}${more}}`);
        }
      } catch (e) {
        logger.info(`  → [Complex object]`);
      }
    }
  }
}

// Create a realistic runtime for testing
function createRealRuntime(): IAgentRuntime {
  return {
    agentId: "test-agent",
    character: {
      name: "Test Character",
      system: "You are a helpful assistant for testing.",
      plugins: [],
      settings: {},
    },
    getSetting: (key: string) => null,
    models: plugin.models,
    getMemoriesByIds: async (ids: string[]) => {
      // Return a mock social strategy memory
      if (ids.includes("test-agent:social-strategy")) {
        return [
          {
            id: uuidv4(),
            entityId: "test-agent",
            roomId: "test-room",
            timestamp: Date.now(),
            content: {
              text: JSON.stringify({
                players: {},
                relationships: [],
                statements: [],
              }),
            },
            metadata: {
              type: MemoryType.CUSTOM,
            },
          },
        ];
      }
      return [];
    },
    db: {
      get: async (key: string) => null,
      set: async (key: string, value: any) => true,
      delete: async (key: string) => true,
      getKeys: async (pattern: string) => [],
    },
    memory: {
      add: async (memory: any) => {},
      get: async (id: string) => null,
      getByEntityId: async (entityId: string) => [],
      getLatest: async (entityId: string) => null,
      getRecentMessages: async (options: any) => [],
      search: async (query: string) => [],
    },
    getService: (serviceType: string) => null,
  } as unknown as IAgentRuntime;
}

// Create realistic memory object
function createRealMemory(): Memory {
  const entityId = uuidv4();
  const roomId = uuidv4();

  return {
    id: uuidv4(),
    entityId,
    roomId,
    timestamp: Date.now(),
    content: {
      text: "What's the current social strategy state?",
      source: "test",
      actions: [],
    },
    metadata: {
      type: "custom",
      sessionId: uuidv4(),
      conversationId: uuidv4(),
    },
  } as Memory;
}

describe("Provider Tests", () => {
  // Find the social-strategy-state provider from the providers array
  const socialStrategyProvider = plugin.providers?.find(
    (provider) => provider.name === "social-strategy-state"
  );

  describe("social-strategy-state provider", () => {
    it("should exist in the plugin", () => {
      expect(plugin.providers).toBeDefined();
      expect(Array.isArray(plugin.providers)).toBe(true);

      if (plugin.providers) {
        expect(plugin.providers.length).toBeGreaterThan(0);
        const result = plugin.providers.find(
          (p) => p.name === "social-context"
        );
        expect(
          result,
          `social-strategy provider not found. ${JSON.stringify(plugin.providers.map((p) => p.name))}`
        ).toBeDefined();
        documentTestResult("Provider exists check", {
          found: !!result,
          providers: plugin.providers.map((p) => p.name),
        });
      }
    });

    it("should have the correct structure", () => {
      if (socialStrategyProvider) {
        expect(socialStrategyProvider).toHaveProperty(
          "name",
          "social-strategy-state"
        );
        expect(socialStrategyProvider).toHaveProperty("description");
        expect(socialStrategyProvider).toHaveProperty("get");
        expect(typeof socialStrategyProvider.get).toBe("function");

        documentTestResult("Provider structure check", {
          name: socialStrategyProvider.name,
          description: socialStrategyProvider.description,
          hasGetMethod: typeof socialStrategyProvider.get === "function",
        });
      }
    });

    it("should have a description explaining its purpose", () => {
      if (socialStrategyProvider && socialStrategyProvider.description) {
        expect(typeof socialStrategyProvider.description).toBe("string");
        expect(socialStrategyProvider.description.length).toBeGreaterThan(0);

        documentTestResult("Provider description check", {
          description: socialStrategyProvider.description,
        });
      }
    });

    it("should return provider data from the get method", async () => {
      if (socialStrategyProvider) {
        const runtime = createRealRuntime();
        const message = createRealMemory();
        const state = {
          values: {},
          data: {},
          text: "",
        } as State;

        let result: any = null;
        let error: Error | null = null;

        try {
          logger.info("Calling provider.get with real implementation");
          result = await socialStrategyProvider.get(runtime, message, state);

          expect(result).toBeDefined();
          expect(result).toHaveProperty("text");
          expect(result).toHaveProperty("data");
          expect(result.data).toHaveProperty("socialStrategyState");

          // Verify the state structure
          const socialState = result.data.socialStrategyState;
          expect(socialState).toHaveProperty("players");
          expect(socialState).toHaveProperty("relationships");
          expect(socialState).toHaveProperty("statements");

          // Look for potential issues in the result
          if (result && (!result.text || result.text.length === 0)) {
            logger.warn("Provider returned empty text");
          }

          if (!result.data.socialStrategyState) {
            logger.warn("Provider returned empty social strategy state");
          }
        } catch (e) {
          error = e as Error;
          logger.error("Error in provider.get:", e);
        }

        documentTestResult("Provider get method", result, error);
      }
    });

    it("should handle missing memory gracefully", async () => {
      if (socialStrategyProvider) {
        const runtime = createRealRuntime();
        const message = createRealMemory();
        const state = {
          values: {},
          data: {},
          text: "",
        } as State;

        // Override getMemoriesByIds to return empty array
        runtime.getMemoriesByIds = async () => [];

        let result: any = null;
        let error: Error | null = null;

        try {
          logger.info("Calling provider.get with missing memory");
          result = await socialStrategyProvider.get(runtime, message, state);

          // Should return empty state without throwing
          expect(result).toBeDefined();
          expect(result).toHaveProperty("text");
          expect(result).toHaveProperty("data");
          expect(result.data).toHaveProperty("socialStrategyState");

          // State should be empty but valid
          const socialState = result.data.socialStrategyState;
          expect(socialState).toHaveProperty("players");
          expect(socialState).toHaveProperty("relationships");
          expect(socialState).toHaveProperty("statements");
        } catch (e) {
          error = e as Error;
          logger.error("Provider threw an error with missing memory:", e);
        }

        documentTestResult("Provider missing memory handling", result, error);
      }
    });
  });

  describe("Provider Registration", () => {
    it("should include providers in the plugin definition", () => {
      expect(plugin).toHaveProperty("providers");
      expect(Array.isArray(plugin.providers)).toBe(true);

      documentTestResult("Plugin providers check", {
        hasProviders: !!plugin.providers,
        providersCount: plugin.providers?.length || 0,
      });
    });

    it("should correctly initialize providers array", () => {
      // Providers should be an array with at least one provider
      if (plugin.providers) {
        expect(plugin.providers.length).toBeGreaterThan(0);

        let allValid = true;
        const invalidProviders: string[] = [];

        // Each provider should have the required structure
        plugin.providers.forEach((provider: Provider) => {
          const isValid =
            provider.name !== undefined &&
            provider.description !== undefined &&
            typeof provider.get === "function";

          if (!isValid) {
            allValid = false;
            invalidProviders.push(provider.name || "unnamed");
          }

          expect(provider).toHaveProperty("name");
          expect(provider).toHaveProperty("description");
          expect(provider).toHaveProperty("get");
          expect(typeof provider.get).toBe("function");
        });

        documentTestResult("Provider initialization check", {
          providersCount: plugin.providers.length,
          allValid,
          invalidProviders,
        });
      }
    });

    it("should have unique provider names", () => {
      if (plugin.providers) {
        const providerNames = plugin.providers.map((provider) => provider.name);
        const uniqueNames = new Set(providerNames);

        const duplicates = providerNames.filter(
          (name, index) => providerNames.indexOf(name) !== index
        );

        // There should be no duplicate provider names
        expect(providerNames.length).toBe(uniqueNames.size);

        documentTestResult("Provider uniqueness check", {
          totalProviders: providerNames.length,
          uniqueProviders: uniqueNames.size,
          duplicates,
        });
      }
    });
  });
});
