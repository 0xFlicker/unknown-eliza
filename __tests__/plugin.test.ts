import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import dotenv from "dotenv";
import {
  socialStrategyPlugin,
  MODEL_CONFIGS,
} from "../src/plugin/socialStrategy";
import { ModelType, logger, type IAgentRuntime } from "@elizaos/core";
import { createMockRuntime } from "./utils/core-test-utils";
import { MODEL_TAGS } from "../src/plugin/socialStrategy/promptManager";

// Setup environment variables and logging
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
  result: unknown,
  error: Error | null = null
) {
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

describe("Social Strategy Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct plugin metadata", () => {
      expect(socialStrategyPlugin.name).toBe("social-strategy");
      expect(socialStrategyPlugin.description).toBe(
        "Tracks and manages player relationships and trust scores for social strategy analysis"
      );

      documentTestResult("Plugin metadata check", {
        name: socialStrategyPlugin.name,
        description: socialStrategyPlugin.description,
      });
    });

    it("should have required plugin components", () => {
      expect(socialStrategyPlugin.models).toBeDefined();
      expect(socialStrategyPlugin.actions).toBeDefined();
      expect(socialStrategyPlugin.providers).toBeDefined();

      documentTestResult("Plugin components check", {
        hasModels: !!socialStrategyPlugin.models,
        hasActions: !!socialStrategyPlugin.actions,
        hasProviders: !!socialStrategyPlugin.providers,
      });
    });
  });

  describe("Plugin Models", () => {
    it("should have TEXT_SMALL model defined", () => {
      expect(socialStrategyPlugin.models).toBeDefined();
      const models = socialStrategyPlugin.models!;
      expect(models).toHaveProperty(ModelType.TEXT_SMALL);
      expect(typeof models[ModelType.TEXT_SMALL]).toBe("function");

      documentTestResult("TEXT_SMALL model check", {
        defined: ModelType.TEXT_SMALL in models,
        isFunction: typeof models[ModelType.TEXT_SMALL] === "function",
      });
    });

    it("should have TEXT_LARGE model defined", () => {
      expect(socialStrategyPlugin.models).toBeDefined();
      const models = socialStrategyPlugin.models!;
      expect(models).toHaveProperty(ModelType.TEXT_LARGE);
      expect(typeof models[ModelType.TEXT_LARGE]).toBe("function");

      documentTestResult("TEXT_LARGE model check", {
        defined: ModelType.TEXT_LARGE in models,
        isFunction: typeof models[ModelType.TEXT_LARGE] === "function",
      });
    });

    it("should use correct model configurations", async () => {
      expect(socialStrategyPlugin.models).toBeDefined();
      const models = socialStrategyPlugin.models!;
      const runtime = createMockRuntime();
      const spy = vi.spyOn(runtime, "useModel");

      // Test TEXT_SMALL model
      await models[ModelType.TEXT_SMALL](runtime, {
        prompt: "Test prompt",
      });
      expect(spy).toHaveBeenCalledWith(
        ModelType.TEXT_SMALL,
        expect.objectContaining({
          temperature: 0.3,
          maxTokens: 256,
          frequencyPenalty: 0.3,
          presencePenalty: 0.3,
          prompt: "Test prompt",
        })
      );
      spy.mockClear();

      // Test TEXT_LARGE model with different workloads
      const workloads = [
        { tag: MODEL_TAGS.QUICK_ANALYSIS, temp: 0.3, tokens: 256 },
        { tag: MODEL_TAGS.RELATIONSHIP_ANALYSIS, temp: 0.5, tokens: 512 },
        { tag: MODEL_TAGS.STRATEGY_PLANNING, temp: 0.7, tokens: 1024 },
        { tag: MODEL_TAGS.CREATIVE_ANALYSIS, temp: 0.9, tokens: 2048 },
      ];

      for (const workload of workloads) {
        const prompt = `${workload.tag} Test prompt`;
        await models[ModelType.TEXT_LARGE](runtime, { prompt });
        const expectedConfig =
          workload.tag === MODEL_TAGS.QUICK_ANALYSIS
            ? MODEL_CONFIGS.QUICK_ANALYSIS
            : MODEL_CONFIGS[
                workload.tag === MODEL_TAGS.RELATIONSHIP_ANALYSIS
                  ? "RELATIONSHIP_ANALYSIS"
                  : workload.tag === MODEL_TAGS.STRATEGY_PLANNING
                    ? "STRATEGY_PLANNING"
                    : "CREATIVE_ANALYSIS"
              ];

        // The implementation strips the tag from the prompt
        const sanitizedPrompt = "Test prompt";
        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_LARGE,
          expect.objectContaining({
            temperature: expectedConfig.temperature,
            maxTokens: expectedConfig.maxTokens,
            frequencyPenalty: expectedConfig.frequencyPenalty,
            presencePenalty: expectedConfig.presencePenalty,
            prompt: sanitizedPrompt,
          })
        );
        spy.mockClear();
      }

      documentTestResult("Model configurations check", {
        testedWorkloads: workloads.length,
      });
    });
  });

  describe("Plugin Actions", () => {
    it("should have trackConversation action", () => {
      expect(socialStrategyPlugin.actions).toBeDefined();
      const actions = socialStrategyPlugin.actions!;
      const trackConversationAction = actions.find(
        (action) => action.name === "trackConversation"
      );
      expect(trackConversationAction).toBeDefined();
      expect(trackConversationAction?.description).toBe(
        "Track a new conversation or update an existing one"
      );

      documentTestResult("trackConversation action check", {
        exists: !!trackConversationAction,
        hasDescription: !!trackConversationAction?.description,
        hasHandler: typeof trackConversationAction?.handler === "function",
        hasValidate: typeof trackConversationAction?.validate === "function",
      });
    });

    it("should have getPlayerInfo action", () => {
      expect(socialStrategyPlugin.actions).toBeDefined();
      const actions = socialStrategyPlugin.actions!;
      const getPlayerInfoAction = actions.find(
        (action) => action.name === "getPlayerInfo"
      );
      expect(getPlayerInfoAction).toBeDefined();
      expect(getPlayerInfoAction?.description).toBe(
        "Retrieve information about a specific player"
      );

      documentTestResult("getPlayerInfo action check", {
        exists: !!getPlayerInfoAction,
        hasDescription: !!getPlayerInfoAction?.description,
        hasHandler: typeof getPlayerInfoAction?.handler === "function",
        hasValidate: typeof getPlayerInfoAction?.validate === "function",
      });
    });
  });

  describe("Plugin Providers", () => {
    it("should have social-strategy-state provider", () => {
      expect(socialStrategyPlugin.providers).toBeDefined();
      const providers = socialStrategyPlugin.providers!;
      const stateProvider = providers.find(
        (provider) => provider.name === "social-strategy-state"
      );
      expect(stateProvider).toBeDefined();
      expect(stateProvider?.description).toBe(
        "Provides the current social strategy state"
      );

      documentTestResult("social-strategy-state provider check", {
        exists: !!stateProvider,
        hasDescription: !!stateProvider?.description,
        hasGet: typeof stateProvider?.get === "function",
      });
    });
  });
});
