import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type Plugin,
  type Provider,
  State,
  type UUID,
  asUUID,
  validateUuid,
  elizaLogger,
} from "@elizaos/core";
import { trackConversation } from "./actions/trackConversation";
import type {
  PlayerEntity,
  PlayerRelationship,
  PlayerStatement,
  SocialStrategyState,
} from "./types";
import {
  formatHandles,
  SocialStrategyPromptBuilder,
  type ModelWorkload,
} from "./promptManager";
import { getParticipantsForRoom } from "../safeUtils";
import { conversationTrackingEvaluator } from "./evaluators/conversationTracker";

const logger = elizaLogger.child({
  plugin: "social-strategy",
});
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

Please provide a JSON response ONLY with the following structure:
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

No additional text or formatting, just the JSON object.

Analysis:`;
}

export const getPlayerInfoHandler = async (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
) => {
  const socialState = (state?.socialStrategyState as SocialStrategyState) || {
    players: {},
    relationships: [],
    statements: [],
    metadata: { lastAnalysis: Date.now(), version: "1.0.0" },
  };
  const { playerId } = message.content as { playerId: UUID };

  const player = socialState.players[playerId];
  if (!player) {
    return {
      success: false,
      message: "Player not found",
    };
  }

  // Get relationships involving this player
  const relationships = socialState.relationships.filter((rel) => {
    const sourceId = rel.sourceEntityId;
    const targetId = rel.targetEntityId;
    return sourceId === playerId || targetId === playerId;
  });

  // Get statements about this player
  const statements = socialState.statements.filter((stmt) => {
    const targetId = stmt.data.targetEntityId;
    return targetId === playerId;
  });

  return {
    success: true,
    data: {
      player,
      relationships,
      statements,
    },
  };
};

export type SocialStrategyContext = {
  values: {
    players: PlayerEntity[];
    relationships: PlayerRelationship[];
    statements: PlayerStatement[];
  };
  text: string;
};

export const socialStrategyPlugin: Plugin = {
  // Ensure connections default to conversation when type is undefined
  init: async (_config, runtime) => {
    const originalEnsureConnection = runtime.ensureConnection.bind(runtime);
    runtime.ensureConnection = async (params) => {
      const fixedType = params.type ?? "conversation";
      return originalEnsureConnection({ ...params, type: fixedType });
    };
  },
  name: "social-strategy",
  description:
    "Tracks and manages player relationships and trust scores for social strategy analysis",
  providers: [
    {
      name: "social-context",
      description:
        "Provides formatted social context (players, trust scores, top relationships, recent statements) for prompt injection",
      get: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
      ): Promise<SocialStrategyContext> => {
        logger.info(`Getting social context for room ${message.roomId}`);
        const { roomId } = message;
        // -------------------------
        // 1. Gather data from runtime
        // -------------------------
        const participantIds = await getParticipantsForRoom(runtime, roomId);

        logger.info(
          `Participant IDs: ${JSON.stringify(participantIds, null, 2)}`
        );

        // Build a map for quick lookup
        const playerMap: Record<string, PlayerEntity> = {};
        for (const id of participantIds) {
          if (id) {
            const player = await runtime.getEntityById(id);
            if (player) {
              playerMap[id] = player as PlayerEntity;
            }
          }
        }

        // -------------------------
        // 2. Runtime relationships & statements
        // -------------------------
        const relSet = new Set<string>();
        const runtimeRelationships: Array<PlayerRelationship> = [];
        for (const [id, player] of Object.entries(playerMap)) {
          if (!id || !validateUuid(id)) continue;
          const entityId = asUUID(id);
          const rels = await runtime.getRelationships({ entityId });
          for (const r of rels) {
            const key = `${r.sourceEntityId}-${r.targetEntityId}`;
            if (relSet.has(key)) continue;
            relSet.add(key);
            runtimeRelationships.push(r as PlayerRelationship);
          }
        }

        const runtimeStatements: Array<PlayerStatement> = [];
        for (const [id, player] of Object.entries(playerMap)) {
          if (!id || !validateUuid(id)) continue;
          const entityId = asUUID(id);
          const comps = await runtime.getComponents(entityId);
          for (const c of comps) {
            if (c.type === "social-strategy-statement") {
              runtimeStatements.push(c as PlayerStatement);
            }
          }
        }

        // -------------------------
        // 3. Fallback/merge with in-memory SocialStrategyState
        // -------------------------
        let players = Object.values(playerMap);
        let relationships = [...runtimeRelationships];
        let statements = [...runtimeStatements];

        const recentStatements = statements.slice(-5);
        const socialContext = {
          players,
          relationships,
          statements: recentStatements,
        };

        // ----------------------------------------------------
        // 4. If no relevant data, return empty provider result
        // ----------------------------------------------------
        if (
          players.length === 0 &&
          relationships.length === 0 &&
          recentStatements.length === 0
        ) {
          return {
            values: {
              players: [],
              relationships: [],
              statements: [],
            },
            text: "",
          };
        }

        // ----------------------------------------------------
        // 5. Build user-friendly prompt using PromptManager
        // ----------------------------------------------------

        const friendlyContextLines: string[] = [];

        // Players section
        if (players.length > 0) {
          friendlyContextLines.push("Players:");
          for (const p of players) {
            friendlyContextLines.push(
              `- ${formatHandles(p.names)} (Trust: ${p.metadata.trustScore})`
            );
          }
          friendlyContextLines.push("");
        }

        // Relationships section
        if (relationships.length > 0) {
          friendlyContextLines.push("Relationships:");
          for (const r of relationships) {
            const sourcePlayer = playerMap[r.sourceEntityId];
            const targetPlayer = playerMap[r.targetEntityId];
            if (!sourcePlayer || !targetPlayer) continue;
            friendlyContextLines.push(
              `- ${formatHandles(sourcePlayer.names)} -> ${formatHandles(targetPlayer.names)} (${r.metadata.relationshipType}, strength ${r.metadata.strength})`
            );
          }
          friendlyContextLines.push("");
        }

        // Recent statements section
        if (recentStatements.length > 0) {
          friendlyContextLines.push("Recent Statements:");
          for (const s of recentStatements) {
            const speakerPlayer = playerMap[s.data.speakerEntityId];
            const targetPlayer = playerMap[s.data.targetEntityId];
            if (!speakerPlayer || !targetPlayer) continue;
            const snippet =
              s.data.content.length > 100
                ? `${s.data.content.slice(0, 97)}…`
                : s.data.content;
            friendlyContextLines.push(
              `- ${formatHandles(speakerPlayer.names)} about ${formatHandles(targetPlayer.names)}: "${snippet}"`
            );
          }
        }

        const friendlyContext = friendlyContextLines.join("\n");

        const prompt = new SocialStrategyPromptBuilder()
          .withWorkload("RELATIONSHIP_ANALYSIS" as ModelWorkload)
          .withMetadata("roomId", roomId ?? "unknown")
          .withPrompt(friendlyContext)
          .build().prompt;

        return {
          values: {
            players,
            relationships,
            statements,
          },
          text: prompt,
        };
      },
    },
  ],

  // Evaluators that passively listen to the conversation and keep the
  // social graph up-to-date.
  evaluators: [conversationTrackingEvaluator],

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
      handler: getPlayerInfoHandler,
    },
  ],
};

export { trackConversation } from "./actions/trackConversation";
export { conversationTrackingEvaluator } from "./evaluators/conversationTracker";
export * from "./types";
