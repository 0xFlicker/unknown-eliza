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
      expect(socialStrategyPlugin.actions).toBeDefined();
      expect(socialStrategyPlugin.providers).toBeDefined();

      documentTestResult("Plugin components check", {
        hasActions: !!socialStrategyPlugin.actions,
        hasProviders: !!socialStrategyPlugin.providers,
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
        "Track conversation and update player relationships"
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
