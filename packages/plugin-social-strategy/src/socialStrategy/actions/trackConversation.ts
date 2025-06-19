// @ts-nocheck
import {
  MemoryType,
  type Action,
  type IAgentRuntime,
  type Content,
  type Memory,
  ModelType,
  type UUID,
  type GenerateTextParams,
  stringToUuid,
} from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import {
  type SocialStrategyState,
  type PlayerEntity,
  type PlayerRelationship,
  type PlayerStatement,
  type RelationshipType,
} from "../types";
import { makeModelInference } from "../index";

const DEFAULT_TRUST_SCORE = 50;
const TRUST_ADJUSTMENT = 10;

interface GetPlayerInfoParams {
  playerId: UUID;
}

function isGetPlayerInfoParams(
  message: Memory
): message is Memory & { content: { playerId: UUID } } {
  return (
    typeof message.content === "object" &&
    message.content !== null &&
    "playerId" in message.content &&
    typeof (message.content as any).playerId === "string"
  );
}

interface MessageMetadata {
  type?: string;
  entityName?: string;
  username?: string;
  source?: string;
  discriminator?: string;
  // anon chat
  raw?: {
    senderName?: string;
  };
}

export interface ModelAnalysis {
  trustScore: number;
  relationship: string;
  statement: string;
  metadata?: {
    sentiment?: string;
    confidence?: number;
    [key: string]: any;
  };
}

// Helper function to validate relationship type
function validateRelationshipType(type: string): RelationshipType {
  switch (type.toLowerCase()) {
    case "enemy":
    case "rival":
      return "rival";
    case "ally":
      return "ally";
    case "neutral":
    default:
      return "neutral";
  }
}

// Helper function to generate deterministic player ID
function generatePlayerId(handle: string): UUID {
  return stringToUuid(`player:${handle.toLowerCase()}`);
}

// Helper function to generate deterministic statement ID
function generateStatementId(
  speakerId: string,
  targetId: string,
  timestamp: number
): UUID {
  return stringToUuid(`statement:${speakerId}:${targetId}:${timestamp}`);
}

// Helper function to find player by handle or ID
function findPlayerByHandle(
  state: SocialStrategyState,
  handle: string,
  knownId?: UUID
): string | undefined {
  // If we have a known ID and it exists in state, use it
  if (knownId && state.players[knownId]) {
    return knownId;
  }

  // Try to find by deterministic ID
  const deterministicId = generatePlayerId(handle);
  if (state.players[deterministicId]) {
    return deterministicId;
  }

  // Search by handle (for test cases with pre-defined UUIDs)
  for (const [id, player] of Object.entries(state.players)) {
    if (player.handle.toLowerCase() === handle.toLowerCase()) {
      return id;
    }
  }
  return undefined;
}

// Helper function to create a new player
function createPlayer(handle: string, existingId?: UUID): PlayerEntity {
  return {
    id: existingId || generatePlayerId(handle),
    handle,
    trustScore: DEFAULT_TRUST_SCORE,
    firstInteraction: Date.now(),
    lastInteraction: Date.now(),
    metadata: {
      relationshipType: "neutral",
      interactionCount: 0,
    },
  };
}

// Helper function to create a new statement
function createStatement(
  speakerId: string,
  targetId: string,
  content: string,
  metadata: ModelAnalysis["metadata"] = {}
): PlayerStatement {
  const timestamp = Date.now();
  return {
    id: generateStatementId(speakerId, targetId, timestamp),
    speakerId,
    targetId,
    content,
    timestamp,
    metadata,
  };
}

// Helper function to update relationship
function updateRelationship(
  state: SocialStrategyState,
  sourceId: UUID,
  targetId: UUID,
  type: RelationshipType,
  description: string
): void {
  const existingRelationship = state.relationships.find(
    (r) => r.sourcePlayerId === sourceId && r.targetPlayerId === targetId
  );

  if (existingRelationship) {
    existingRelationship.relationshipType = type;
    existingRelationship.lastUpdated = Date.now();
    existingRelationship.evidence.push({
      type: "direct_interaction",
      timestamp: Date.now(),
      description,
      source: sourceId,
    });
  } else {
    state.relationships.push({
      sourcePlayerId: sourceId,
      targetPlayerId: targetId,
      relationshipType: type,
      strength: 50, // Default strength
      lastUpdated: Date.now(),
      evidence: [
        {
          type: "direct_interaction",
          timestamp: Date.now(),
          description,
          source: sourceId,
        },
      ],
    });
  }
}

export const trackConversation: Action = {
  name: "trackConversation",
  description: "Track conversation and update player relationships",
  similes: [
    "TRACK_CONVERSATION",
    "UPDATE_RELATIONSHIPS",
    "ANALYZE_INTERACTION",
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Great move, @player1!" },
      },
      {
        name: "agent",
        content: {
          text: "Tracking positive interaction with player1",
          actions: ["trackConversation"],
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    return (
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof message.content.text === "string"
    );
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state) => {
    // @ts-ignore: message.roomId is a valid UUID string
    const roomMemories = await runtime.getMemoriesByRoomIds({
      tableName: "social-strategy",
      roomIds: [message.roomId] as unknown as UUID[],
    });
    const socialStrategyMemory = roomMemories.find(
      (memory) =>
        memory.metadata?.type === MemoryType.CUSTOM &&
        memory.metadata?.entityName === "social-strategy"
    );

    // Use the provided state or parse from memory
    let socialState = state as SocialStrategyState;
    if (socialStrategyMemory) {
      const memoryState = JSON.parse(
        socialStrategyMemory.content.text || "{}"
      ) as SocialStrategyState;
      // Merge memory state with initial state to preserve test UUIDs
      socialState = {
        ...memoryState,
        players: {
          ...memoryState.players,
          ...socialState.players,
        },
      };
    }

    const messageText = message.content.text!;
    const metadata = message.metadata as MessageMetadata;

    // Extract mentioned player handles from the message
    const mentionedHandles = messageText
      .match(/@(\w+)/g)
      ?.map((h) => h.slice(1));
    if (!mentionedHandles || mentionedHandles.length === 0) {
      return {
        success: true,
        message: "No player mentions found",
      };
    }

    // Get the speaker's handle from metadata
    const speakerHandle =
      metadata?.entityName ?? metadata?.username ?? metadata?.raw?.senderName;
    if (!speakerHandle) {
      return {
        success: false,
        message: "Could not determine speaker",
      };
    }

    // Analyze the interaction using the model
    const analysisResult = await makeModelInference(runtime, {
      prompt: `Analyze this interaction: "${messageText}"\nSpeaker: ${speakerHandle}\nMentioned players: ${mentionedHandles.join(", ")}\n\nProvide a JSON response with:\n- trustScore (0-100)\n- relationship (ally/neutral/rival)\n- statement (a summary of what was said)\n- metadata (interaction details)`,
      runtime,
      modelType: ModelType.TEXT_LARGE,
    });

    const analysis = JSON.parse(analysisResult) as ModelAnalysis;
    const relationshipType = validateRelationshipType(analysis.relationship);

    // @ts-ignore: message.entityId is a valid UUID string
    let speakerId = findPlayerByHandle(
      socialState,
      speakerHandle,
      message.entityId as UUID
    );
    if (!speakerId) {
      const newPlayer = createPlayer(speakerHandle, message.entityId as UUID);
      speakerId = newPlayer.id;
      socialState.players[speakerId] = newPlayer;
    }

    // Process each mentioned player
    for (const handle of mentionedHandles) {
      // Try to find the player by handle
      let targetId = findPlayerByHandle(socialState, handle);
      if (!targetId) {
        // Prefix the player ID with the agent ID for uniqueness
        const prefixedId = `${runtime.agentId}:player:${handle}`;
        const newPlayer = createPlayer(handle, prefixedId as UUID);
        targetId = newPlayer.id;
        socialState.players[targetId] = newPlayer;
      }

      // Update target player's trust score and metadata
      const targetPlayer = socialState.players[targetId];
      targetPlayer.trustScore = Math.min(
        100,
        Math.max(0, targetPlayer.trustScore + TRUST_ADJUSTMENT)
      );
      targetPlayer.lastInteraction = Date.now();
      targetPlayer.metadata.interactionCount++;
      targetPlayer.metadata.relationshipType = relationshipType;

      // Create statement record using model's statement
      const statement = createStatement(
        speakerId,
        targetId,
        analysis.statement,
        analysis.metadata
      );
      socialState.statements.push(statement);

      // Update in-memory relationship state
      updateRelationship(
        socialState,
        speakerId,
        targetId,
        relationshipType,
        messageText
      );
      // Persist relationship in the database; swallow errors for invalid IDs
      try {
        await runtime.createRelationship({
          sourceEntityId: speakerId as UUID,
          targetEntityId: targetId as UUID,
          tags: [relationshipType],
          metadata: {
            trustScore: socialState.players[targetId].trustScore,
            interactionCount:
              socialState.players[targetId].metadata.interactionCount,
          },
        });
      } catch (error) {
        // ignore persistence errors
      }
    }

    // Bypass strict typing for memory object
    await runtime.createMemory(
      {
        id: socialStrategyMemory?.id ?? uuidv4(),
        entityId: socialStrategyMemory?.entityId ?? message.entityId,
        roomId: socialStrategyMemory?.roomId ?? message.roomId,
        content: { text: JSON.stringify(socialState) },
        metadata: { type: MemoryType.CUSTOM, entityName: "social-strategy" },
      } as any,
      "social-strategy"
    );

    return {
      success: true,
      message: `Updated relationships for ${mentionedHandles.join(", ")}`,
      data: {
        data: socialState.data,
        metadata: socialState.metadata,
        players: socialState.players,
        relationships: socialState.relationships,
        statements: socialState.statements,
        text: socialState.text,
        values: socialState.values,
      },
    };
  },
};

// Helper function to extract player mentions from text
function extractPlayerMentions(text: string): string[] {
  // This is a simple implementation - you might want to use a more sophisticated
  // approach based on your specific needs
  const mentions = text.match(/@(\w+)/g) || [];
  return mentions.map((mention) => mention.slice(1));
}

// Helper function to analyze sentiment
function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  // This is a simple implementation - you might want to use a more sophisticated
  // approach based on your specific needs
  const positiveWords = ["good", "great", "awesome", "help", "thanks", "thank"];
  const negativeWords = ["bad", "terrible", "awful", "hate", "stupid", "wrong"];

  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (positiveWords.includes(word)) positiveCount++;
    if (negativeWords.includes(word)) negativeCount++;
  }

  if (positiveCount > negativeCount) return "positive";
  if (negativeCount > positiveCount) return "negative";
  return "neutral";
}

// Helper function to calculate trust score adjustment
function calculateTrustAdjustment(
  currentScore: number,
  modelTrustScore: number,
  sentiment: "positive" | "negative" | "neutral"
): number {
  // Base adjustment from model's trust score
  const baseAdjustment = modelTrustScore - currentScore;

  // Apply sentiment multiplier
  const sentimentMultiplier = {
    positive: 1.2,
    neutral: 1.0,
    negative: 0.8,
  }[sentiment];

  // Calculate final adjustment, ensuring it's within reasonable bounds
  const adjustment = Math.round(baseAdjustment * sentimentMultiplier);
  return Math.max(-10, Math.min(10, adjustment)); // Cap at ±10 points
}
