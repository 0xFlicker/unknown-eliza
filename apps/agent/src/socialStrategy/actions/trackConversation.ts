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
import { addStatement, upsertRelationship } from "../runtime/memory";

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
  name: "TRACK_CONVERSATION",
  description:
    "Track and analyze conversations to update player relationships and trust scores. Should be called after a message with @mentions is sent.",
  similes: ["SAVE_RELATIONSHIP", "SAVE_STATEMENT"],
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
    const isValid =
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof message.content.text === "string";
    return isValid;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state) => {
    const relationships: PlayerRelationship[] = state.values.relationships;
    const players: PlayerEntity[] = state.values.players;
    const statements: PlayerStatement[] = state.values.statements;

    console.log("🚀 [trackConversation] handler started");
    for (const player of players) {
      if (player.metadata?.new) {
        delete player.metadata.new;
        await runtime.createEntity(player);
      } else if (player.metadata?.needsSave) {
        delete player.metadata.needsSave;
        await runtime.updateEntity(player);
      }
    }

    for (const statement of statements) {
      if (statement.metadata?.new) {
        delete statement.metadata.new;
        await runtime.createComponent(statement);
      } else if (statement.metadata?.needsSave) {
        delete statement.metadata.needsSave;
        await runtime.updateComponent(statement);
      }
    }

    for (const relationship of relationships) {
      if (relationship.metadata?.new) {
        delete relationship.metadata.new;
        await runtime.createRelationship(relationship);
      } else if (relationship.metadata?.needsSave) {
        delete relationship.metadata.needsSave;
        await runtime.updateRelationship(relationship);
      }
    }
  },
};
