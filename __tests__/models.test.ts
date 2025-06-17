import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { socialStrategyPlugin as plugin } from "../src/plugin/socialStrategy";
import { ModelType, logger } from "@elizaos/core";
import type { IAgentRuntime } from "@elizaos/core";
import dotenv from "dotenv";
import { documentTestResult, createMockRuntime } from "./utils/core-test-utils";
import {
  SocialStrategyPromptBuilder,
  MODEL_TAGS,
} from "../src/plugin/socialStrategy/promptManager";

// Define a simplified version of the GenerateTextParams for testing
interface TestGenerateParams {
  prompt: string;
  stopSequences?: string[];
  maxTokens?: number;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

// Setup environment variables from .env file
dotenv.config();

// Spy on logger to capture logs for documentation
beforeAll(() => {
  vi.spyOn(logger, "info");
  vi.spyOn(logger, "error");
  vi.spyOn(logger, "warn");
});

afterAll(() => {
  vi.restoreAllMocks();
});

/**
 * Tests a model function with core testing patterns
 * @param modelType The type of model to test
 * @param modelFn The model function to test
 */
const runCoreModelTests = async (
  modelType: keyof typeof ModelType,
  modelFn: (
    runtime: IAgentRuntime,
    params: TestGenerateParams
  ) => Promise<string>
) => {
  // Create a mock runtime for model testing
  const mockRuntime = createMockRuntime();

  // Test with basic parameters
  const basicParams: TestGenerateParams = {
    prompt: `Test prompt for ${modelType}`,
    stopSequences: ["STOP"],
    maxTokens: 100,
  };

  let basicResponse: string | null = null;
  let basicError: Error | null = null;

  try {
    basicResponse = await modelFn(mockRuntime, basicParams);
    expect(basicResponse).toBeTruthy();
    expect(typeof basicResponse).toBe("string");
  } catch (e) {
    basicError = e as Error;
    logger.error(`${modelType} model call failed:`, e);
  }

  // Test with empty prompt
  const emptyParams: TestGenerateParams = {
    prompt: "",
  };

  let emptyResponse: string | null = null;
  let emptyError: Error | null = null;

  try {
    emptyResponse = await modelFn(mockRuntime, emptyParams);
  } catch (e) {
    emptyError = e as Error;
    logger.error(`${modelType} empty prompt test failed:`, e);
  }

  // Test with all parameters
  const fullParams: TestGenerateParams = {
    prompt: `Comprehensive test prompt for ${modelType}`,
    stopSequences: ["STOP1", "STOP2"],
    maxTokens: 200,
    temperature: 0.8,
    frequencyPenalty: 0.6,
    presencePenalty: 0.4,
  };

  let fullResponse: string | null = null;
  let fullError: Error | null = null;

  try {
    fullResponse = await modelFn(mockRuntime, fullParams);
  } catch (e) {
    fullError = e as Error;
    logger.error(`${modelType} all parameters test failed:`, e);
  }

  return {
    basic: { response: basicResponse, error: basicError },
    empty: { response: emptyResponse, error: emptyError },
    full: { response: fullResponse, error: fullError },
  };
};

describe("Plugin Models", () => {
  it("should have models defined", () => {
    expect(plugin.models).toBeDefined();
    if (plugin.models) {
      expect(typeof plugin.models).toBe("object");
    }
  });

  describe("TEXT_SMALL Model", () => {
    it("should have a TEXT_SMALL model defined", () => {
      if (plugin.models) {
        expect(plugin.models).toHaveProperty(ModelType.TEXT_SMALL);
        expect(typeof plugin.models[ModelType.TEXT_SMALL]).toBe("function");
      }
    });

    it("should run core tests for TEXT_SMALL model", async () => {
      if (plugin.models && plugin.models[ModelType.TEXT_SMALL]) {
        const results = await runCoreModelTests(
          ModelType.TEXT_SMALL,
          plugin.models[ModelType.TEXT_SMALL]
        );

        documentTestResult("TEXT_SMALL core model tests", results);
      }
    });

    it("should use QUICK_ANALYSIS config for TEXT_SMALL", async () => {
      if (plugin.models && plugin.models[ModelType.TEXT_SMALL]) {
        const mockRuntime = createMockRuntime();
        const spy = vi.spyOn(mockRuntime, "useModel");

        await plugin.models[ModelType.TEXT_SMALL](mockRuntime, {
          prompt: "test",
        });

        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_SMALL,
          expect.objectContaining({
            temperature: 0.3,
            frequencyPenalty: 0.3,
            presencePenalty: 0.3,
            maxTokens: 256,
          })
        );
      }
    });
  });

  describe("TEXT_LARGE Model", () => {
    it("should have a TEXT_LARGE model defined", () => {
      if (plugin.models) {
        expect(plugin.models).toHaveProperty(ModelType.TEXT_LARGE);
        expect(typeof plugin.models[ModelType.TEXT_LARGE]).toBe("function");
      }
    });

    it("should run core tests for TEXT_LARGE model", async () => {
      if (plugin.models && plugin.models[ModelType.TEXT_LARGE]) {
        const results = await runCoreModelTests(
          ModelType.TEXT_LARGE,
          plugin.models[ModelType.TEXT_LARGE]
        );

        documentTestResult("TEXT_LARGE core model tests", results);
      }
    });

    it("should use appropriate config based on prompt tags", async () => {
      if (plugin.models && plugin.models[ModelType.TEXT_LARGE]) {
        const mockRuntime = createMockRuntime();
        const spy = vi.spyOn(mockRuntime, "useModel");

        // Test strategy planning config
        const strategyPrompt = new SocialStrategyPromptBuilder()
          .withPrompt("Analyze player interaction patterns")
          .withWorkload("STRATEGY_PLANNING")
          .build();

        await plugin.models[ModelType.TEXT_LARGE](mockRuntime, strategyPrompt);
        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_LARGE,
          expect.objectContaining({
            prompt: "Analyze player interaction patterns",
            temperature: 0.7,
            frequencyPenalty: 0.7,
            presencePenalty: 0.7,
            maxTokens: 1024,
          })
        );

        // Test creative analysis config
        const creativePrompt = new SocialStrategyPromptBuilder()
          .withPrompt("Analyze player behavior patterns")
          .withWorkload("CREATIVE_ANALYSIS")
          .build();

        await plugin.models[ModelType.TEXT_LARGE](mockRuntime, creativePrompt);
        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_LARGE,
          expect.objectContaining({
            prompt: "Analyze player behavior patterns",
            temperature: 0.9,
            frequencyPenalty: 0.9,
            presencePenalty: 0.9,
            maxTokens: 2048,
          })
        );

        // Test quick analysis config
        const quickPrompt = new SocialStrategyPromptBuilder()
          .withPrompt("Quick player sentiment check")
          .withWorkload("QUICK_ANALYSIS")
          .build();

        await plugin.models[ModelType.TEXT_LARGE](mockRuntime, quickPrompt);
        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_LARGE,
          expect.objectContaining({
            prompt: "Quick player sentiment check",
            temperature: 0.3,
            frequencyPenalty: 0.3,
            presencePenalty: 0.3,
            maxTokens: 256,
          })
        );

        // Test default relationship analysis config
        const defaultPrompt = new SocialStrategyPromptBuilder()
          .withPrompt("Analyze player relationships")
          .withWorkload("RELATIONSHIP_ANALYSIS")
          .build();

        await plugin.models[ModelType.TEXT_LARGE](mockRuntime, defaultPrompt);
        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_LARGE,
          expect.objectContaining({
            prompt: "Analyze player relationships",
            temperature: 0.5,
            frequencyPenalty: 0.5,
            presencePenalty: 0.5,
            maxTokens: 512,
          })
        );
      }
    });

    it("should handle metadata in prompts", async () => {
      if (plugin.models && plugin.models[ModelType.TEXT_LARGE]) {
        const mockRuntime = createMockRuntime();
        const spy = vi.spyOn(mockRuntime, "useModel");

        const promptWithMetadata = new SocialStrategyPromptBuilder()
          .withPrompt("Analyze player relationships")
          .withWorkload("RELATIONSHIP_ANALYSIS")
          .withMetadata("playerId", "player123")
          .withMetadata("context", "game_session_1")
          .build();

        await plugin.models[ModelType.TEXT_LARGE](
          mockRuntime,
          promptWithMetadata
        );

        // Verify the sanitized prompt doesn't include metadata
        expect(spy).toHaveBeenCalledWith(
          ModelType.TEXT_LARGE,
          expect.objectContaining({
            prompt: "Analyze player relationships",
            temperature: 0.5,
            frequencyPenalty: 0.5,
            presencePenalty: 0.5,
            maxTokens: 512,
          })
        );
      }
    });
  });
});
