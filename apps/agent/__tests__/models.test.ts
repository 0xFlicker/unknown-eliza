import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { socialStrategyPlugin as plugin } from "../src/socialStrategy/index";
import { ModelType, logger, type GenerateTextParams } from "@elizaos/core";
import type { IAgentRuntime } from "@elizaos/core";
import dotenv from "dotenv";
import { documentTestResult, createMockRuntime } from "./utils/core-test-utils";
import {
  SocialStrategyPromptBuilder,
  analyzePrompt,
} from "../src/socialStrategy/promptManager";

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

      await mockRuntime.useModel(ModelType.TEXT_LARGE, {
        ...strategyPrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

      expect(spy).toHaveBeenCalledWith(
        ModelType.TEXT_LARGE,
        expect.objectContaining({
          prompt: "[[SSA:STRAT]]  Analyze player interaction patterns",
          stopSequences: ["[[SSA:END]]"],
        })
      );

      // Test creative analysis config
      const creativePrompt = new SocialStrategyPromptBuilder()
        .withPrompt("Analyze player behavior patterns")
        .withWorkload("CREATIVE_ANALYSIS")
        .build();

      await mockRuntime.useModel(ModelType.TEXT_LARGE, {
        ...creativePrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

      expect(spy).toHaveBeenCalledWith(
        ModelType.TEXT_LARGE,
        expect.objectContaining({
          prompt: "[[SSA:CREATIVE]]  Analyze player behavior patterns",
          stopSequences: ["[[SSA:END]]"],
        })
      );

      // Test quick analysis config
      const quickPrompt = new SocialStrategyPromptBuilder()
        .withPrompt("Quick player sentiment check")
        .withWorkload("QUICK_ANALYSIS")
        .build();

      await mockRuntime.useModel(ModelType.TEXT_LARGE, {
        ...quickPrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

      expect(spy).toHaveBeenCalledWith(
        ModelType.TEXT_LARGE,
        expect.objectContaining({
          prompt: "[[SSA:QUICK]]  Quick player sentiment check",
          stopSequences: ["[[SSA:END]]"],
        })
      );

      // Test default relationship analysis config
      const defaultPrompt = new SocialStrategyPromptBuilder()
        .withPrompt("Analyze player relationships")
        .withWorkload("RELATIONSHIP_ANALYSIS")
        .build();

      await mockRuntime.useModel(ModelType.TEXT_LARGE, {
        ...defaultPrompt,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

      expect(spy).toHaveBeenCalledWith(
        ModelType.TEXT_LARGE,
        expect.objectContaining({
          prompt: "[[SSA:REL]]  Analyze player relationships",
          stopSequences: ["[[SSA:END]]"],
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

      await mockRuntime.useModel(ModelType.TEXT_LARGE, {
        ...promptWithMetadata,
        runtime: mockRuntime,
        modelType: ModelType.TEXT_LARGE,
      });

      // Verify the prompt includes metadata tags
      expect(spy).toHaveBeenCalledWith(
        ModelType.TEXT_LARGE,
        expect.objectContaining({
          prompt:
            '[[SSA:REL]] [[SSA:playerId="player123"]] [[SSA:context="game_session_1"]] Analyze player relationships',
          stopSequences: ["[[SSA:END]]"],
        })
      );

      // Verify the analyzePrompt function can extract the sanitized prompt
      const analysis = analyzePrompt(promptWithMetadata.prompt);
      expect(analysis.sanitizedPrompt).toBe("Analyze player relationships");
      expect(analysis.workload).toBe("RELATIONSHIP_ANALYSIS");
    });
  });
});
