import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type Plugin,
  type Provider,
  State,
  type UUID,
  logger,
} from "@elizaos/core";
import { trackConversation } from "./actions/trackConversation";
import type { SocialStrategyState } from "./types";

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
    const sourceId = rel.sourcePlayerId;
    const targetId = rel.targetPlayerId;
    return sourceId === playerId || targetId === playerId;
  });

  // Get statements about this player
  const statements = socialState.statements.filter((stmt) => {
    const targetId = stmt.targetId;
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
      get: async (runtime: IAgentRuntime, message: Memory) => {
        const { roomId } = message;
        // Fetch participants in the room via entity IDs to avoid date parsing issues
        const participantIds = await runtime.getParticipantsForRoom(roomId);
        const participants: Array<{ id?: UUID; names: string[] }> = [];
        for (const id of participantIds) {
          const ent = await runtime.getEntityById(id);
          if (ent) {
            participants.push({ id: ent.id, names: ent.names });
          }
        }
        // Build players list
        const players = participants.map((e) => ({
          handle: e.names[0],
          trustScore: 50, // default or extend with component data
        }));
        // Build a map for lookup
        const playerMap: Record<string, string> = {};
        for (const e of participants) {
          if (e.id) {
            playerMap[e.id] = e.names[0];
          }
        }
        // Fetch relationships for each participant
        const relSet = new Set<string>();
        const relationships: Array<{
          source: string;
          target: string;
          relationshipType: string;
          strength: number;
        }> = [];
        for (const e of participants) {
          if (!e.id) continue;
          const rels = await runtime.getRelationships({ entityId: e.id });
          for (const r of rels) {
            const key = `${r.sourceEntityId}-${r.targetEntityId}`;
            if (relSet.has(key)) continue;
            relSet.add(key);
            relationships.push({
              source: playerMap[r.sourceEntityId] ?? r.sourceEntityId,
              target: playerMap[r.targetEntityId] ?? r.targetEntityId,
              relationshipType: r.tags?.[0] ?? "",
              strength: (r.metadata as any)?.strength ?? 0,
            });
          }
        }
        // Fetch statements stored as components
        const statements: Array<{
          speaker: string;
          target: string;
          content: string;
        }> = [];
        for (const e of participants) {
          if (!e.id) continue;
          const comps = await runtime.getComponents(e.id);
          for (const c of comps) {
            if (c.type === "social-strategy-statement") {
              const targetId = c.data.targetEntityId as UUID;
              statements.push({
                speaker: playerMap[c.entityId] ?? c.entityId,
                target: playerMap[targetId] ?? targetId,
                content: (c.data as any).content,
              });
            }
          }
        }
        const recentStatements = statements.slice(-5);
        const socialContext = { players, relationships, recentStatements };
        const contextString = JSON.stringify(socialContext);
        return {
          data: { socialContext },
          values: { socialContext: contextString },
          text: `Social Context: ${contextString}`,
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
      handler: getPlayerInfoHandler,
    },
  ],
};

export { trackConversation } from "./actions/trackConversation";
export * from "./types";
