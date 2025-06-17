import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { socialStrategyPlugin as plugin } from "../src/plugin/socialStrategy";
import { logger } from "@elizaos/core";
import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import {
  runCoreActionTests,
  documentTestResult,
  createMockRuntime,
  createMockMessage,
  createMockState,
} from "./utils/core-test-utils";
import { type SocialStrategyState } from "../src/plugin/socialStrategy/types";

// Setup environment variables
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

describe("Social Strategy Plugin Actions", () => {
  // Find the trackConversation action from the plugin
  const trackConversationAction = plugin.actions?.find(
    (action) => action.name === "trackConversation"
  );

  // Run core tests on all plugin actions
  it("should pass core action tests", () => {
    if (plugin.actions) {
      const coreTestResults = runCoreActionTests(plugin.actions);
      expect(coreTestResults).toBeDefined();
      expect(coreTestResults.formattedNames).toBeDefined();
      expect(coreTestResults.formattedActions).toBeDefined();
      expect(coreTestResults.composedExamples).toBeDefined();

      // Document the core test results
      documentTestResult("Core Action Tests", coreTestResults);
    }
  });

  describe("trackConversation Action", () => {
    it("should exist in the plugin", () => {
      expect(trackConversationAction).toBeDefined();
    });

    it("should have the correct structure", () => {
      if (trackConversationAction) {
        expect(trackConversationAction).toHaveProperty(
          "name",
          "trackConversation"
        );
        expect(trackConversationAction).toHaveProperty("description");
        expect(trackConversationAction).toHaveProperty("validate");
        expect(trackConversationAction).toHaveProperty("handler");
        expect(trackConversationAction).toHaveProperty("similes");
        expect(trackConversationAction).toHaveProperty("examples");
      }
    });

    describe("validate function", () => {
      it("should return false for empty messages", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          const mockMessage = createMockMessage("");
          const mockState = createMockState();

          const result = await trackConversationAction.validate(
            runtime,
            mockMessage,
            mockState
          );
          expect(result).toBe(false);
        }
      });

      it("should return true for valid messages", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          const mockMessage = createMockMessage("Hello @player1!");
          const mockState = createMockState();

          const result = await trackConversationAction.validate(
            runtime,
            mockMessage,
            mockState
          );
          expect(result).toBe(true);
        }
      });
    });

    describe("handler function", () => {
      it("should create new player entities for mentioned players", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          runtime.createMemory = vi.fn().mockResolvedValue(undefined);
          const mockMessage = createMockMessage("Hello @player1 and @player2!");
          const mockState = createMockState() as State & SocialStrategyState;
          mockState.players = {};
          mockState.relationships = [];
          mockState.statements = [];
          mockState.metadata = {
            lastAnalysis: Date.now(),
            version: "1.0.0",
          };

          const result = await trackConversationAction.handler(
            runtime,
            mockMessage,
            mockState,
            {},
            vi.fn(),
            []
          );

          expect(result).toBe(true);
          expect(Object.keys(mockState.players)).toHaveLength(2);
          expect(
            mockState.players[`${runtime.agentId}:player:player1`]
          ).toBeDefined();
          expect(
            mockState.players[`${runtime.agentId}:player:player2`]
          ).toBeDefined();
        }
      });

      it("should update existing player entities", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          runtime.createMemory = vi.fn().mockResolvedValue(undefined);
          const playerId = `${runtime.agentId}:player:player1`;
          const mockMessage = createMockMessage("Hello again @player1!");
          const mockState = createMockState() as State & SocialStrategyState;
          mockState.players = {
            [playerId]: {
              id: playerId,
              handle: "player1",
              trustScore: 50,
              firstInteraction: Date.now() - 1000,
              lastInteraction: Date.now() - 1000,
              metadata: {
                interactionCount: 1,
                relationshipType: "neutral",
              },
            },
          };
          mockState.relationships = [];
          mockState.statements = [];
          mockState.metadata = {
            lastAnalysis: Date.now(),
            version: "1.0.0",
          };

          const result = await trackConversationAction.handler(
            runtime,
            mockMessage,
            mockState,
            {},
            vi.fn(),
            []
          );

          expect(result).toBe(true);
          expect(mockState.players[playerId].metadata.interactionCount).toBe(2);
          expect(mockState.players[playerId].lastInteraction).toBeGreaterThan(
            mockState.players[playerId].firstInteraction
          );
        }
      });

      it("should create relationships between mentioned players", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          runtime.createMemory = vi.fn().mockResolvedValue(undefined);
          const mockMessage = createMockMessage(
            "@player1 and @player2 are great friends!"
          );
          const mockState = createMockState() as State & SocialStrategyState;
          mockState.players = {};
          mockState.relationships = [];
          mockState.statements = [];
          mockState.metadata = {
            lastAnalysis: Date.now(),
            version: "1.0.0",
          };

          const result = await trackConversationAction.handler(
            runtime,
            mockMessage,
            mockState,
            {},
            vi.fn(),
            []
          );

          expect(result).toBe(true);
          expect(mockState.relationships).toHaveLength(1);
          const relationship = mockState.relationships[0];
          expect(relationship.relationshipType).toBe("ally");
          expect(relationship.strength).toBeGreaterThan(50);
        }
      });

      it("should create statements for mentioned players", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          runtime.createMemory = vi.fn().mockResolvedValue(undefined);
          const mockMessage = createMockMessage("@player1 is a great player!");
          const mockState = createMockState() as State & SocialStrategyState;
          mockState.players = {};
          mockState.relationships = [];
          mockState.statements = [];
          mockState.metadata = {
            lastAnalysis: Date.now(),
            version: "1.0.0",
          };

          const result = await trackConversationAction.handler(
            runtime,
            mockMessage,
            mockState,
            {},
            vi.fn(),
            []
          );

          expect(result).toBe(true);
          expect(mockState.statements).toHaveLength(1);
          const statement = mockState.statements[0];
          expect(statement.sentiment).toBe("positive");
          expect(statement.context).toBe("direct_mention");
        }
      });

      it("should persist state to memory", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          runtime.createMemory = vi.fn().mockResolvedValue(undefined);
          const mockMessage = createMockMessage("Hello @player1!");
          const mockState = createMockState() as State & SocialStrategyState;
          mockState.players = {};
          mockState.relationships = [];
          mockState.statements = [];
          mockState.metadata = {
            lastAnalysis: Date.now(),
            version: "1.0.0",
          };

          const result = await trackConversationAction.handler(
            runtime,
            mockMessage,
            mockState,
            {},
            vi.fn(),
            []
          );

          expect(result).toBe(true);
          // Check that createMemory was called with the correct type (case-insensitive)
          const call = (runtime.createMemory as any).mock.calls[0][0];
          expect(call).toHaveProperty("metadata");
          expect(call.metadata).toHaveProperty("type");
          expect(call.metadata.type.toLowerCase()).toBe("custom");
        }
      });

      it("should handle errors gracefully", async () => {
        if (trackConversationAction) {
          const runtime = createMockRuntime();
          runtime.createMemory = vi.fn().mockResolvedValue(undefined);
          // This message will have content.text undefined, which should trigger the error
          const mockMessage = { ...createMockMessage("") };
          delete mockMessage.content.text;
          const mockState = createMockState();

          await expect(
            trackConversationAction.handler(
              runtime,
              mockMessage,
              mockState,
              {},
              vi.fn(),
              []
            )
          ).rejects.toThrow("content is required");
        }
      });
    });
  });
});
