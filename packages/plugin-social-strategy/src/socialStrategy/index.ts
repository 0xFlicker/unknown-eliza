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
import { conversationTrackingEvaluator } from "./evaluators/conversationTracker";
import { socialContextProvider } from "./providers/socialContext";

const logger = elizaLogger.child({
  plugin: "social-strategy",
});

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
  providers: [socialContextProvider],

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
export { socialContextProvider } from "./providers/socialContext";
export * from "./types";

/* promptManager utilities no longer required in this module */
