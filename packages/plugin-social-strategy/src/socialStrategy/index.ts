import {
  type Action,
  type IAgentRuntime,
  type Memory,
  MemoryType,
  type Plugin,
  type Provider,
  type UUID,
  logger,
} from "@elizaos/core";
import { trackConversation } from "./actions/trackConversation";

// Types for social strategy state
export interface Player {
  id: UUID;
  handle: string;
  discriminator: string;
  trustScore: number;
  relationship: "ally" | "neutral" | "rival";
  lastSeen: number;
  metadata: Record<string, any>;
}

export interface Relationship {
  id: UUID;
  sourceEntityId: UUID;
  targetEntityId: UUID;
  relationshipType: string;
  strength: number;
  metadata: Record<string, any>;
}

export interface Statement {
  id: UUID;
  sourceEntityId: UUID;
  targetEntityId: UUID;
  content: string;
  statementType: string;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  metadata: Record<string, any>;
}

export interface SocialStrategyState {
  players: Record<UUID, Player>;
  relationships: Relationship[];
  statements: Statement[];
  metadata: {
    lastAnalysis: number;
    version: string;
  };
}

// Helper function to build analysis prompts
export function buildAnalysisPrompt(
  text: string,
  speakingPlayer: string,
  mentionedPlayers: string[]
): string {
  const playerList =
    mentionedPlayers.length > 0 ? mentionedPlayers.join(", ") : "None";

  return `Analyze this conversation and provide insights about player relationships and trust.

Conversation: "${text}"
Speaker: ${speakingPlayer || "Unknown"}
Mentioned Players: ${playerList}

Please provide a JSON response with the following structure:
{
  "trustScore": <number between 0-100>,
  "relationship": "<ally|neutral|rival>",
  "statement": "<brief analysis of the interaction>",
  "metadata": {
    "interactionType": "<positive|negative|neutral>",
    "sentiment": "<positive|negative|neutral>",
    "confidence": <number between 0-1>
  }
}

Analysis:`;
}

export const socialStrategyPlugin: Plugin = {
  name: "social-strategy",
  description:
    "Tracks and manages player relationships and trust scores for social strategy analysis",
  providers: [
    {
      name: "social-strategy-state",
      description: "Provides the current social strategy state",
      get: async (runtime, message, state) => {
        // Get the social strategy memory
        const memories = await runtime.getMemoriesByIds([
          `${runtime.agentId}:social-strategy`,
        ]);

        const socialStrategyMemory = memories.find(
          (memory) => memory.metadata?.type === MemoryType.CUSTOM
        );

        if (!socialStrategyMemory) {
          return { text: "" };
        }

        // Parse the state from the memory content
        const socialState = JSON.parse(
          socialStrategyMemory.content.text || "{}"
        ) as SocialStrategyState;

        return {
          text: "", // No text needed for this provider
          data: { socialStrategyState: socialState }, // Make state available to actions
        };
      },
    },
  ],

  actions: [
    trackConversation,
    {
      name: "getPlayerInfo",
      description: "Retrieve information about a specific player",
      similes: ["PLAYER_INFO", "LOOKUP_PLAYER", "PLAYER_PROFILE"],
      examples: [
        [
          {
            name: "user",
            content: { playerId: "player1", text: "Get info for player1" },
          },
          {
            name: "agent",
            content: {
              text: "Player info for player1: trust 50, neutral relationship.",
              actions: ["getPlayerInfo"],
            },
          },
        ],
      ],
      validate: async (runtime: IAgentRuntime, message: Memory) => {
        return (
          typeof message.content === "object" &&
          message.content !== null &&
          "playerId" in message.content &&
          typeof message.content.playerId === "string"
        );
      },
      handler: async (runtime: IAgentRuntime, message: Memory, state) => {
        const socialState = ((state as any)
          ?.socialStrategyState as SocialStrategyState) || {
          players: {},
          relationships: [],
          statements: [],
          metadata: { lastAnalysis: Date.now(), version: "1.0.0" },
        };
        const { playerId } = message.content as { playerId: string };

        const player = socialState.players[playerId];
        if (!player) {
          return {
            success: false,
            message: "Player not found",
          };
        }

        // Get relationships involving this player
        const relationships = socialState.relationships.filter(
          (rel) =>
            rel.sourceEntityId === playerId || rel.targetEntityId === playerId
        );

        // Get statements about this player
        const statements = socialState.statements.filter(
          (stmt) => stmt.targetEntityId === playerId
        );

        return {
          success: true,
          data: {
            player,
            relationships,
            statements,
          },
        };
      },
    },
  ],

  routes: [
    {
      path: "/social-strategy",
      type: "GET",
      handler: async (req, res, runtime) => {
        // Get the social strategy memory
        const memories = await runtime.getMemoriesByIds([
          `${runtime.agentId}:social-strategy`,
        ]);

        const socialStrategyMemory = memories.find(
          (memory) => memory.metadata?.type === MemoryType.CUSTOM
        );

        if (!socialStrategyMemory) {
          return res.json({
            players: {},
            relationships: [],
            statements: [],
          });
        }

        // Parse the state from the memory content
        const socialState = JSON.parse(
          socialStrategyMemory.content.text || "{}"
        ) as SocialStrategyState;

        return res.json(socialState);
      },
    },
  ],
};

export { trackConversation } from "./actions/trackConversation";
export * from "./types";
