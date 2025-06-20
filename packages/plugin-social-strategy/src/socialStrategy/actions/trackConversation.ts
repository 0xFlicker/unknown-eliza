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
import { makeModelInference, buildAnalysisPrompt } from "../index";

const DEFAULT_TRUST_SCORE = 50;
const TRUST_ADJUSTMENT = 10;

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

  // Simple regex to find @mentions
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
  name: "trackConversation",
  description:
    "Track and analyze conversations to update player relationships and trust scores",
  similes: ["CONVERSATION_TRACKING", "SOCIAL_ANALYSIS", "RELATIONSHIP_UPDATE"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Player A said 'I trust Player B completely'",
        },
      },
      {
        name: "agent",
        content: {
          text: "Updated trust score for Player B based on Player A's statement.",
          actions: ["trackConversation"],
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

        const mentionedPlayer: Player = {
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

      // Start AI analysis
      console.log("🚀 [trackConversation] starting AI analysis");

      const analysisPrompt = buildAnalysisPrompt(
        textContent,
        speakingPlayer.handle,
        mentionedPlayers
      );

      console.log("🚀 [trackConversation] analysisPrompt:", analysisPrompt);

      // Call the model directly with appropriate configuration
      let modelAnalysis: any = null;
      try {
        console.log("🤖 [trackConversation] calling model directly");

        // Use a simple configuration for the model call
        const modelParams = {
          prompt: analysisPrompt,
          temperature: 0.3,
          maxTokens: 512,
        };

        console.log("🤖 [trackConversation] model params:", {
          prompt: modelParams.prompt.substring(0, 200) + "...",
          temperature: modelParams.temperature,
          maxTokens: modelParams.maxTokens,
        });

        const modelResponse = await runtime.useModel(
          ModelType.TEXT_LARGE,
          modelParams
        );
        console.log("🤖 [trackConversation] model response:", modelResponse);

        // Parse the JSON response
        try {
          modelAnalysis = JSON.parse(modelResponse);
          console.log("🤖 [trackConversation] parsed analysis:", modelAnalysis);
        } catch (parseError) {
          console.error(
            "🤖 [trackConversation] failed to parse model response:",
            parseError
          );
          // Fallback to default analysis
          modelAnalysis = {
            trustScore: 50,
            relationship: "neutral",
            statement: "Unable to analyze interaction",
            metadata: {
              interactionType: "neutral",
              sentiment: "neutral",
              confidence: 0.5,
            },
          };
        }
      } catch (modelError) {
        console.error("🤖 [trackConversation] model call failed:", modelError);
        // Fallback to default analysis
        modelAnalysis = {
          trustScore: 50,
          relationship: "neutral",
          statement: "Model analysis failed",
          metadata: {
            interactionType: "neutral",
            sentiment: "neutral",
            confidence: 0.5,
          },
        };
      }

      // Update trust scores and relationships based on analysis
      console.log(
        "🚀 [trackConversation] updating based on analysis:",
        modelAnalysis
      );

      for (const [playerId, player] of Object.entries(newPlayers)) {
        console.log(
          "🚀 [trackConversation] updating player:",
          playerId,
          player.handle
        );

        const updatedPlayer = {
          ...player,
          trustScore: modelAnalysis.trustScore || player.trustScore,
          relationship: modelAnalysis.relationship || player.relationship,
        };

        console.log("🚀 [trackConversation] updated player:", updatedPlayer);
        newPlayers[playerId as UUID] = updatedPlayer;
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

      // Check if storeMemory method exists (may not be available in test environment)
      if (typeof runtime.storeMemory === "function") {
        await runtime.storeMemory({
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
      } else {
        console.log(
          "🚀 [trackConversation] storeMemory not available, skipping memory storage"
        );
      }

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
