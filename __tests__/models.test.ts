import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import {
  socialStrategyPlugin as plugin,
  makeModelInference,
  MODEL_CONFIGS,
} from "../src/plugin/socialStrategy";
import { ModelType, logger, type GenerateTextParams } from "@elizaos/core";
import type { IAgentRuntime } from "@elizaos/core";
import dotenv from "dotenv";
import { documentTestResult, createMockRuntime } from "./utils/core-test-utils";
import {
  SocialStrategyPromptBuilder,
  MODEL_TAGS,
} from "../src/plugin/socialStrategy/promptManager";

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
 * Tests model inference with core testing patterns
 * @param modelType The type of model to test
 */
const runCoreModelTests = async (modelType: keyof typeof ModelType) => {
  // Create a mock runtime for model testing
  const mockRuntime = createMockRuntime();

  // Test with basic parameters
  const basicParams: GenerateTextParams = {
    prompt: `Test prompt for ${modelType}`,
    stopSequences: ["STOP"],
    maxTokens: 100,
    runtime: mockRuntime,
    modelType,
  };

  let basicResponse: string | null = null;
  let basicError: Error | null = null;

  try {
    basicResponse = await makeModelInference(mockRuntime, basicParams);
    expect(basicResponse).toBeTruthy();
    expect(typeof basicResponse).toBe("string");
  } catch (e) {
    basicError = e as Error;
    logger.error(`${modelType} model call failed:`, e);
  }

  // Test with empty prompt
  const emptyParams: GenerateTextParams = {
    prompt: "",
    runtime: mockRuntime,
    modelType,
  };

  let emptyResponse: string | null = null;
  let emptyError: Error | null = null;

  try {
    emptyResponse = await makeModelInference(mockRuntime, emptyParams);
  } catch (e) {
    emptyError = e as Error;
    logger.error(`${modelType} empty prompt test failed:`, e);
  }

  // Test with all parameters
  const fullParams: GenerateTextParams = {
    prompt: `Comprehensive test prompt for ${modelType}`,
    stopSequences: ["STOP1", "STOP2"],
    maxTokens: 200,
    temperature: 0.8,
    frequencyPenalty: 0.6,
    presencePenalty: 0.4,
    runtime: mockRuntime,
    modelType,
  };

  let fullResponse: string | null = null;
  let fullError: Error | null = null;

  try {
    fullResponse = await makeModelInference(mockRuntime, fullParams);
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

describe("Social Strategy Model Inference", () => {
  describe("TEXT_LARGE Model", () => {
    it("should use appropriate config based on prompt tags", async () => {
      const mockRuntime = createMockRuntime();
      const spy = vi.spyOn(mockRuntime, "useModel");

      // Test strategy planning config
      const strategyPrompt = new SocialStrategyPromptBuilder()
        .withPrompt("Analyze player interaction patterns")
        .withWorkload("STRATEGY_PLANNING")
        .build();

      await makeModelInference(mockRuntime, {
        ...strategyPrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

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

      await makeModelInference(mockRuntime, {
        ...creativePrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

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

      await makeModelInference(mockRuntime, {
        ...quickPrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

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

      await makeModelInference(mockRuntime, {
        ...defaultPrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

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
    });

    it("should handle metadata in prompts", async () => {
      const mockRuntime = createMockRuntime();
      const spy = vi.spyOn(mockRuntime, "useModel");

      const promptWithMetadata = new SocialStrategyPromptBuilder()
        .withPrompt("Analyze player relationships")
        .withWorkload("RELATIONSHIP_ANALYSIS")
        .withMetadata("playerId", "player123")
        .withMetadata("context", "game_session_1")
        .build();

      await makeModelInference(mockRuntime, {
        ...promptWithMetadata,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

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
    });
  });
});
