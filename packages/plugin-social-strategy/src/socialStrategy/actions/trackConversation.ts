// @ts-nocheck
import {
  MemoryType,
  type Action,
  type IAgentRuntime,
  type Content,
  type Memory,
  type UUID,
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

const DEFAULT_TRUST_SCORE = 50;
const TRUST_ADJUSTMENT = 10;

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
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
    [key: string]: string | number | boolean | undefined;
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

// Helper function to generate deterministic player ID (per agent per handle)
function generatePlayerId(agentId: string, handle: string): UUID {
  return stringToUuid(`${agentId}:player:${handle.toLowerCase()}`);
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
  agentId: string,
  handle: string,
  knownId?: UUID
): string | undefined {
  // If we have a known ID and it exists in state, use it
  if (knownId && state.players[knownId]) {
    return knownId;
  }
  // Try to find by deterministic ID
  const deterministicId = generatePlayerId(agentId, handle);
  if (state.players[deterministicId]) {
    return deterministicId;
  }
  // Search by handle (for test cases with pre-defined UUIDs)
  // Only return valid UUIDs to prevent string-based IDs from being used
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [id, player] of Object.entries(state.players)) {
    if (
      player.handle.toLowerCase() === handle.toLowerCase() &&
      uuidRegex.test(id)
    ) {
      return id;
    }
  }
  return undefined;
}

// Helper function to create a new player
function createPlayer(
  agentId: string,
  handle: string,
  existingId?: UUID
): PlayerEntity {
  return {
    id: existingId || generatePlayerId(agentId, handle),
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

// Helper function to extract mentioned players from text
function extractMentionedPlayers(text: string): string[] {
  console.log("🔍 [extractMentionedPlayers] input text:", text);

  const mentionRegex = /@(\w+)/g;
  const matches = text.match(mentionRegex);

  if (!matches) {
    console.log("🔍 [extractMentionedPlayers] no mentions found");
    return [];
  }

  // Extract the username part (remove @)
  const players = matches.map((match) => match.substring(1));
  console.log("🔍 [extractMentionedPlayers] found players:", players);

  return players;
}

export const trackConversation: Action = {
  name: "CONVERSATION_TRACKING",
  description:
    "Track and analyze conversations to update player relationships and trust scores",
  similes: ["SOCIAL_ANALYSIS", "RELATIONSHIP_UPDATE"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Player A said 'I trust Player B completely'",
          actions: ["RELATIONSHIP_UPDATE"],
        },
      },
      {
        name: "agent",
        content: {
          text: "Updated trust score for Player B based on Player A's statement.",
          actions: ["CONVERSATION_TRACKING"],
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    console.log("🔍 [trackConversation] validate called with message:", {
      id: message.id,
      entityId: message.entityId,
      content: message.content,
      metadata: message.metadata,
    });

    const isValid =
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof message.content.text === "string";

    console.log("🔍 [trackConversation] validate result:", isValid);
    return isValid;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state) => {
    const relationships: PlayerRelationship[] = state.values.relationships;
    const players: PlayerEntity[] = state.values.players;
    const statements: PlayerStatement[] = state.values.statements;

    console.log("🚀 [trackConversation] handler started");
    console.log("🚀 [trackConversation] message:", {
      id: message.id,
      entityId: message.entityId,
      content: message.content,
      metadata: message.metadata,
    });
    console.log(
      "🚀 [trackConversation] state:",
      JSON.stringify(state, null, 2)
    );

    try {
      const socialState = state as SocialStrategyState;
      console.log("🚀 [trackConversation] socialState parsed:", {
        players: Object.keys(socialState.players || {}).length,
        relationships: Array.isArray(socialState.relationships)
          ? socialState.relationships.length
          : "NOT_ARRAY",
        statements: Array.isArray(socialState.statements)
          ? socialState.statements.length
          : "NOT_ARRAY",
      });

      // Extract text content
      const textContent = (message.content as Content).text;
      console.log("🚀 [trackConversation] textContent:", textContent);

      // Extract entity information
      const entityId = message.entityId;
      const entityName = (message.metadata as any)?.entityName || "Unknown";
      const username = (message.metadata as any)?.username || "Unknown";
      const discriminator = (message.metadata as any)?.discriminator || "0000";
      const roomId = (message.metadata as any)?.roomId || uuidv4();

      console.log("🚀 [trackConversation] extracted entity info:", {
        entityId,
        entityName,
        username,
        discriminator,
        roomId,
      });

      // Generate deterministic UUIDs for players
      const agentId = runtime.agentId;
      console.log("🚀 [trackConversation] agentId:", agentId);

      // Extract mentioned players from text
      const mentionedPlayers = extractMentionedPlayers(textContent);
      console.log("🚀 [trackConversation] mentionedPlayers:", mentionedPlayers);

      // Create or update the speaking player
      const speakingPlayerId = stringToUuid(
        `${agentId}:player:${username.toLowerCase()}`
      );
      console.log("🚀 [trackConversation] speakingPlayerId:", speakingPlayerId);

      const speakingPlayer: Player = {
        id: speakingPlayerId,
        handle: username,
        discriminator,
        trustScore: socialState.players[speakingPlayerId]?.trustScore ?? 50,
        relationship:
          socialState.players[speakingPlayerId]?.relationship ?? "neutral",
        lastSeen: Date.now(),
        metadata: {
          entityName,
          roomId,
          source: "conversation",
        },
      };

      console.log(
        "🚀 [trackConversation] speakingPlayer created:",
        speakingPlayer
      );

      // Update state with speaking player
      const updatedPlayers = {
        ...socialState.players,
        [speakingPlayerId]: speakingPlayer,
      };

      console.log(
        "🚀 [trackConversation] updatedPlayers keys:",
        Object.keys(updatedPlayers)
      );

      // Process mentioned players
      const newPlayers: Record<UUID, Player> = {};
      const newRelationships: Relationship[] = [];
      const newStatements: Statement[] = [];

      console.log(
        "🚀 [trackConversation] starting to process mentioned players, count:",
        mentionedPlayers.length
      );

      for (const mentionedHandle of mentionedPlayers) {
        console.log(
          "🚀 [trackConversation] processing mentioned handle:",
          mentionedHandle
        );

        const mentionedPlayerId = stringToUuid(
          `${agentId}:player:${mentionedHandle.toLowerCase()}`
        );
        console.log(
          "🚀 [trackConversation] mentionedPlayerId:",
          mentionedPlayerId
        );

        // Create or update mentioned player
        const existingMentionedPlayer = updatedPlayers[mentionedPlayerId];
        console.log(
          "🚀 [trackConversation] existingMentionedPlayer:",
          existingMentionedPlayer
        );

        const mentionedPlayer: PlayerEntity = {
          id: mentionedPlayerId,
          handle: mentionedHandle,
          discriminator: "0000",
          trustScore: existingMentionedPlayer?.trustScore ?? 50,
          relationship: existingMentionedPlayer?.relationship ?? "neutral",
          lastSeen: Date.now(),
          metadata: {
            entityName: mentionedHandle,
            roomId,
            source: "conversation",
          },
        };

        console.log(
          "🚀 [trackConversation] mentionedPlayer created:",
          mentionedPlayer
        );
        newPlayers[mentionedPlayerId] = mentionedPlayer;

        // Create relationship between speaking and mentioned player
        const relationshipId = uuidv4() as UUID;
        console.log("🚀 [trackConversation] relationshipId:", relationshipId);

        const relationship: Relationship = {
          id: relationshipId,
          sourceEntityId: speakingPlayerId,
          targetEntityId: mentionedPlayerId,
          relationshipType: "mentions",
          strength: 1,
          metadata: {
            source: "conversation",
            timestamp: Date.now(),
          },
        };

        console.log(
          "🚀 [trackConversation] relationship created:",
          relationship
        );
        newRelationships.push(relationship);

        // Create statement about the mentioned player
        const statementId = uuidv4() as UUID;
        console.log("🚀 [trackConversation] statementId:", statementId);

        const statement: Statement = {
          id: statementId,
          sourceEntityId: speakingPlayerId,
          targetEntityId: mentionedPlayerId,
          content: textContent,
          statementType: "mention",
          sentiment: "neutral",
          confidence: 0.5,
          metadata: {
            source: "conversation",
            timestamp: Date.now(),
            roomId,
          },
        };

        console.log("🚀 [trackConversation] statement created:", statement);
        newStatements.push(statement);
      }

      console.log("🚀 [trackConversation] processing complete. Summary:", {
        newPlayersCount: Object.keys(newPlayers).length,
        newRelationshipsCount: newRelationships.length,
        newStatementsCount: newStatements.length,
      });

      // ---------------------------------------------
      // Apply sentiments collected by provider (if any)
      // ---------------------------------------------

      const sentiments =
        (state as any)?.__socialStrategy?.recentSentiments ?? [];

      for (const sent of sentiments) {
        const tgtId = sent.target.id;
        if (tgtId in newPlayers) {
          const target = newPlayers[tgtId];
          target.relationship = sent.relationshipType;
          if (sent.sentiment === "positive") {
            target.trustScore = clamp(
              target.trustScore + TRUST_ADJUSTMENT,
              0,
              100
            );
          } else if (sent.sentiment === "negative") {
            target.trustScore = clamp(
              target.trustScore - TRUST_ADJUSTMENT,
              0,
              100
            );
          }
        }
      }

      // Combine all data
      console.log("🚀 [trackConversation] combining data");

      const finalPlayers = {
        ...updatedPlayers,
        ...newPlayers,
      };

      console.log(
        "🚀 [trackConversation] finalPlayers keys:",
        Object.keys(finalPlayers)
      );

      const finalRelationships = [
        ...(Array.isArray(socialState.relationships)
          ? socialState.relationships
          : []),
        ...newRelationships,
      ];

      console.log(
        "🚀 [trackConversation] finalRelationships length:",
        finalRelationships.length
      );

      const finalStatements = [
        ...(Array.isArray(socialState.statements)
          ? socialState.statements
          : []),
        ...newStatements,
      ];

      console.log(
        "🚀 [trackConversation] finalStatements length:",
        finalStatements.length
      );

      // Create updated state
      const updatedState: SocialStrategyState = {
        players: finalPlayers,
        relationships: finalRelationships,
        statements: finalStatements,
        metadata: {
          lastAnalysis: Date.now(),
          version: "1.0.0",
        },
      };

      console.log("🚀 [trackConversation] final state summary:", {
        playersCount: Object.keys(updatedState.players).length,
        relationshipsCount: updatedState.relationships.length,
        statementsCount: updatedState.statements.length,
      });

      // Store the updated state in memory
      console.log("🚀 [trackConversation] storing state in memory");

      const memoryId = `${agentId}:social-strategy`;
      console.log("🚀 [trackConversation] memoryId:", memoryId);

      await runtime.createMemory({
        id: memoryId as UUID,
        content: {
          text: JSON.stringify(updatedState),
        },
        metadata: {
          type: MemoryType.CUSTOM,
          source: "social-strategy",
          timestamp: Date.now(),
        },
      });
      console.log("🚀 [trackConversation] memory stored successfully");

      return {
        success: true,
        data: updatedState,
      };
    } catch (error) {
      console.error("🚀 [trackConversation] handler error:", error);
      console.error(
        "🚀 [trackConversation] error stack:",
        error instanceof Error ? error.stack : "No stack"
      );
      throw error;
    }
  },
};
