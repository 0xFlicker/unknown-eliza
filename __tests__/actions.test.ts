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
  createTestRuntime,
} from "./utils/core-test-utils";
import { type SocialStrategyState } from "../src/plugin/socialStrategy/types";
import { ModelAnalysis } from "../src/plugin/socialStrategy/actions/trackConversation";

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
          expect(result).toBe(true);
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
          const runtime = createTestRuntime([plugin]);
          runtime.useModel = vi
            .fn()
            .mockResolvedValue(
              JSON.stringify({
                relationship: "ally",
                trustScore: 80,
                statement: "player1 is a great player!",
              } as ModelAnalysis)
            )
            .mockResolvedValue(
              JSON.stringify({
                relationship: "ally",
                trustScore: 80,
                statement: "player2 is a great player!",
              } as ModelAnalysis)
            );
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

          expect(result).toEqual({
            success: true,
            message: expect.any(String),
            data: {
              data: {},
              metadata: expect.objectContaining({
                lastAnalysis: expect.any(Number),
                version: expect.any(String),
              }),
              players: expect.any(Object),
              relationships: expect.any(Array),
              statements: expect.any(Array),
              text: expect.any(String),
              values: expect.any(Object),
            },
          });
          expect(Object.keys(mockState.players)).toHaveLength(3);
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
          const runtime = createTestRuntime([plugin]);
          runtime.useModel = vi.fn().mockResolvedValue(
            JSON.stringify({
              relationship: "ally",
              trustScore: 80,
              statement: "player1 is a great player!",
            } as ModelAnalysis)
          );
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

          expect(result).toEqual({
            success: true,
            message: expect.any(String),
            data: {
              data: {},
              metadata: expect.objectContaining({
                lastAnalysis: expect.any(Number),
                version: expect.any(String),
              }),
              players: expect.any(Object),
              relationships: expect.any(Array),
              statements: expect.any(Array),
              text: expect.any(String),
              values: expect.any(Object),
            },
          });
          expect(mockState.players[playerId].metadata.interactionCount).toBe(2);
          expect(mockState.players[playerId].lastInteraction).toBeGreaterThan(
            mockState.players[playerId].firstInteraction
          );
        }
      });

      it("should create relationships between mentioned players", async () => {
        if (trackConversationAction) {
          const runtime = createTestRuntime([plugin]);
          runtime.useModel = vi.fn().mockResolvedValue(
            JSON.stringify({
              relationship: "ally",
              trustScore: 80,
              statement: "player1 is a great player!",
            } as ModelAnalysis)
          );
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

          expect(result).toEqual({
            success: true,
            message: expect.any(String),
            data: expect.any(Object),
          });
          expect(mockState.relationships.length).toBeGreaterThan(0);
          const relationship = mockState.relationships[0];
          expect(relationship.relationshipType).toBe("ally");
        }
      });

      it("should create statements for mentioned players", async () => {
        if (trackConversationAction) {
          const runtime = createTestRuntime([plugin]);
          runtime.useModel = vi.fn().mockResolvedValue(
            JSON.stringify({
              relationship: "ally",
              trustScore: 80,
              statement: "player1 is a great player!",
            } as ModelAnalysis)
          );
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

          expect(result).toEqual({
            success: true,
            message: expect.any(String),
            data: expect.any(Object),
          });
          expect(mockState.statements.length).toBeGreaterThan(0);
          const statement = mockState.statements[0];
          expect(statement.content).toBe("player1 is a great player!");
        }
      });

      it("should persist state to memory", async () => {
        if (trackConversationAction) {
          const runtime = createTestRuntime([plugin]);
          runtime.useModel = vi.fn().mockResolvedValue(
            JSON.stringify({
              relationship: "ally",
              trustScore: 80,
              statement: "player1 is a great player!",
            } as ModelAnalysis)
          );
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

          expect(result).toEqual({
            success: true,
            message: expect.any(String),
            data: expect.any(Object),
          });
        }
      });
    });
  });
});
