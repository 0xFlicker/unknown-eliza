import { describe, it, expect, beforeAll } from "vitest";
import { MemoryType, asUUID, ModelType, type UUID } from "@elizaos/core";
import { socialStrategyPlugin, trackConversation } from "@0xflicker/plugin-social-strategy";
import type { SocialStrategyState } from "@0xflicker/plugin-social-strategy/types";
import { v4 as uuidv4 } from "uuid";
import { createTestRuntime } from "../../utils/core-test-utils";

describe("Social Strategy Trust Tests", () => {
  let runtime;
  let initialState: SocialStrategyState;
  const testRoomId = asUUID(uuidv4());
  const testEntityId = asUUID(uuidv4());
  const agentId = asUUID(uuidv4());
  const testPlayerId = asUUID(uuidv4());
  const otherPlayerId = asUUID(uuidv4());
  const socialStrategyId = asUUID(uuidv4());

  beforeAll(async () => {
    runtime = createTestRuntime([socialStrategyPlugin]);
    runtime.agentId = agentId;
    // Set local mode for testing
    (runtime as any).settings = { localMode: true };

    // Override useModel to use the plugin's model handlers directly
    runtime.useModel = async (
      modelType: (typeof ModelType)[keyof typeof ModelType],
      params: any
    ) => {
      const handler = socialStrategyPlugin.models?.[modelType];
      if (!handler) {
        throw new Error(`No handler found for model type: ${modelType}`);
      }
      return handler(runtime, params);
    };

    // Initialize initial state with two players
    initialState = {
      players: {
        [testPlayerId]: {
          id: testPlayerId,
          handle: "TestPlayer",
          trustScore: 50,
          firstInteraction: Date.now(),
          lastInteraction: Date.now(),
          metadata: {
            relationshipType: "neutral",
            interactionCount: 0,
          },
        },
        [otherPlayerId]: {
          id: otherPlayerId,
          handle: "OtherPlayer",
          trustScore: 50,
          firstInteraction: Date.now(),
          lastInteraction: Date.now(),
          metadata: {
            relationshipType: "neutral",
            interactionCount: 0,
          },
        },
      },
      relationships: [],
      statements: [],
      metadata: {
        lastAnalysis: Date.now(),
        version: "1.0.0",
      },
      values: {},
      data: {},
      text: "",
    };

    // Store initial state in memory
    await runtime.createMemory(
      {
        id: socialStrategyId,
        entityId: testEntityId,
        roomId: testRoomId,
        content: {
          text: JSON.stringify(initialState),
        },
        metadata: {
          type: MemoryType.CUSTOM,
          entityName: "social-strategy",
        },
      },
      "social-strategy"
    );
  });

  it("should update trust score and relationship after interaction", async () => {
    // Create a message from player2 mentioning player1
    const messageId = asUUID(uuidv4());
    const testMessage = {
      id: messageId,
      entityId: otherPlayerId,
      roomId: testRoomId,
      content: {
        text: "Great move, @TestPlayer!", // Mentions player1 by handle
      },
      metadata: {
        type: "message",
        entityName: "OtherPlayer",
        source: "discord",
        username: "OtherPlayer",
        discriminator: "1234",
      },
    };

    // Directly call the trackConversation action
    console.log("Calling trackConversation action...");
    const result = await trackConversation.handler(
      runtime,
      testMessage,
      initialState
    );
    console.log("Action result:", result);

    // Get updated state
    const memories = await runtime.getMemoriesByIds([socialStrategyId]);
    const socialStrategyMemory = memories.find(
      (memory) => memory.metadata?.type === MemoryType.CUSTOM
    );
    const updatedState = JSON.parse(
      socialStrategyMemory!.content.text
    ) as SocialStrategyState;

    // Log player keys and objects for debugging
    console.log("Player keys:", Object.keys(updatedState.players));
    for (const [key, player] of Object.entries(updatedState.players)) {
      console.log("Player:", key, player);
    }

    // Verify that player1's trust score was updated
    expect(updatedState.players[testPlayerId].trustScore).toBe(60);
    expect(
      updatedState.players[testPlayerId].metadata.interactionCount
    ).toBeGreaterThan(0);

    // Verify that a statement was created
    expect(updatedState.statements.length).toBeGreaterThan(0);
    expect(updatedState.statements[0].speakerId).toBe(otherPlayerId);
    expect(updatedState.statements[0].targetId).toBe(testPlayerId);

    // Verify that a relationship was created/updated
    expect(updatedState.relationships.length).toBeGreaterThan(0);
    const relationship = updatedState.relationships[0];
    expect(relationship.sourcePlayerId).toBe(otherPlayerId);
    expect(relationship.targetPlayerId).toBe(testPlayerId);
    expect(relationship.relationshipType).toBe("ally");

    // Verify that the runtime relationship was created
    const runtimeRelationship = await runtime.getRelationship({
      sourceEntityId: otherPlayerId,
      targetEntityId: testPlayerId,
    });
    expect(runtimeRelationship).toBeTruthy();
    expect(runtimeRelationship?.tags).toContain("ally");
    expect(runtimeRelationship?.metadata?.trustScore).toBe(60);
    expect(runtimeRelationship?.metadata?.interactionCount).toBe(1);
  });
});
